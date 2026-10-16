/* =====================================================================
   FIND THE NOTE! - script.js
   This file is the BEHAVIOR of the game. (index.html is the structure,
   style.css is the look.)

   How a round works, in plain words:
     1. A random melody is made for the current level, plus a copy of it
        with ONE note changed.
     2. Player presses Play. Both melodies are scheduled on the audio clock.
     3. The beat buttons unlock. Player clicks the beat they think changed.
     4. The game checks the guess, plays a sound effect, updates lives /
        streak / level / best scores, and offers Replay, Next level
        (or Try again), and Restart.

   Sections in this file:
     1. Data: levels, instruments, scales, sound effects, random helpers
     2. State: the variables that change as the game runs
     3. Page elements: grabbing things from index.html
     4. Saving: best scores and options in localStorage
     5. Drawing helpers: status text, beat buttons, info boxes, which buttons are on
     6. Scheduling notes and sound effects (the new technique: the audio clock)
     7. Playing both melodies
     8. Keeping the screen in sync with the sound
     9. The guess and the result
    10. Rounds, levels and the practice round
    11. The How to play panel and the Options
    12. Start
   ===================================================================== */


/* ---------------------------------------------------------------------
   1. DATA
   --------------------------------------------------------------------- */

/* The 10 levels. Higher level = harder:
     beats    how many notes are in the melody
     beat     seconds from one note to the next (smaller number = faster)
     steps    how far the changed note moves, counted in scale steps
              (smaller = harder to hear)
     replays  how many times you may re-listen BEFORE you guess
              (Infinity means no limit)                                    */
const LEVELS = [
  { beats: 5,  beat: 0.80, steps: 4, replays: Infinity },   // level 1
  { beats: 5,  beat: 0.70, steps: 4, replays: Infinity },   // level 2
  { beats: 6,  beat: 0.60, steps: 3, replays: Infinity },   // level 3
  { beats: 6,  beat: 0.55, steps: 3, replays: Infinity },   // level 4
  { beats: 7,  beat: 0.50, steps: 3, replays: Infinity },   // level 5
  { beats: 8,  beat: 0.42, steps: 2, replays: 3 },          // level 6
  { beats: 8,  beat: 0.36, steps: 2, replays: 3 },          // level 7
  { beats: 10, beat: 0.32, steps: 2, replays: 2 },          // level 8
  { beats: 11, beat: 0.28, steps: 1, replays: 2 },          // level 9
  { beats: 12, beat: 0.24, steps: 1, replays: 1 }           // level 10
];
const TOTAL_LEVELS = LEVELS.length;   // 10, worked out from the list so it never gets out of date
const START_LIVES = 3;                // lives at the start of a game
const PAUSE_SECONDS = 1.2;            // silence between the original and the changed melody

/* The instrument choices in Options. An "instrument" here is just a waveform shape,
   which gives the tone a different character:
     type    the Web Audio waveform name
     volume  how loud (bright waveforms are louder, so they get a lower number) */
const INSTRUMENTS = {
  flute: { label: "Flute (soft)",       type: "triangle", volume: 0.40 },
  bell:  { label: "Pure tone (smooth)", type: "sine",     volume: 0.45 },
  synth: { label: "Synth (bright)",     type: "sawtooth", volume: 0.18 },
  retro: { label: "Retro game (buzzy)", type: "square",   volume: 0.16 }
};

/* The scale choices in Options. "semitones" says how far each step of the scale is above
   the starting note, counted in half-steps (a piano key to the next key is one half-step).
   Major sounds bright, minor sounds moodier. */
const SCALES = {
  major: { label: "Major (bright)", semitones: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: "Minor (moody)",  semitones: [0, 2, 3, 5, 7, 8, 10] }
};

/* The little jingles that play after a guess. Each is a list of pitches (in Hertz),
   the gap between notes in seconds, and the waveform and volume to use. */
const SFX = {
  correct:  { notes: [523.25, 659.25, 783.99],                         gap: 0.09, type: "triangle", volume: 0.30 },
  win:      { notes: [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5], gap: 0.13, type: "triangle", volume: 0.30 },
  wrong:    { notes: [196.0, 155.56],                                  gap: 0.18, type: "square",   volume: 0.14 },
  gameover: { notes: [196.0, 174.61, 155.56, 130.81],                  gap: 0.25, type: "sawtooth", volume: 0.16 }
};

/* The names (keys) used to save things in localStorage. */
const KEYS = {
  best: "findTheNote.best",
  settings: "findTheNote.settings",
  seenHowTo: "findTheNote.seenHowTo"
};

/* Notes are stored as "scale steps":
   0 = the first note of the scale (C), 1 = the next, ... 7 = the same note one octave up, and so on.
   They only become real sound frequencies (in Hertz) at the moment they are played,
   which is why switching the scale in Options changes how the same melody sounds. */
function stepToFreq(step) {
  const scale = SCALES[settings.scale].semitones;
  /* Math.floor(step / 7) counts how many full octaves up we are (7 steps per octave).
     step % 7 is the position inside the octave. 12 half-steps make one octave. */
  const semitones = 12 * Math.floor(step / 7) + scale[step % 7];
  /* Each half-step multiplies the frequency by the 12th root of 2. 261.63 Hz is middle C. */
  return 261.63 * Math.pow(2, semitones / 12);
}

/* A random whole number from low to high, with both ends possible. */
function randInt(low, high) {
  return low + Math.floor(Math.random() * (high - low + 1));
}

/* Makes a random melody. Each note moves up or down by at most 3 steps from the last one,
   so it wanders like a tune instead of jumping around like noise. */
function makeMelody(length) {
  const notes = [randInt(2, 8)];                       // the first note, somewhere in the middle
  while (notes.length < length) {
    const next = notes[notes.length - 1] + randInt(-3, 3);
    notes.push(Math.max(0, Math.min(10, next)));       // keep every note between step 0 and step 10
  }
  return notes;
}


/* ---------------------------------------------------------------------
   2. STATE
   These variables are what the game "remembers" while it runs.

   phase is one of:
     "idle"               nothing playing yet this round
     "playing original"   first melody is sounding
     "pause"              the gap between the melodies
     "playing altered"    second melody is sounding
     "waiting for guess"  beat buttons are unlocked
     "result"             a guess was made
   outcome (only used in the "result" phase) is one of:
     "correct", "wrong", "gameover", "won",
     "practice-correct", "practice-wrong"
   --------------------------------------------------------------------- */
let audioCtx = null;      // the Web Audio "sound engine"; created on the first click
let phase = "idle";
let outcome = null;
let started = false;      // has the player pressed Play yet in this game?
let practice = false;     // true during a practice round (nothing counts)
let startTime = 0;        // the audio-clock time when the original melody began
let lastStatus = "";      // the last message shown, so we don't rewrite the same one

/* Whole-game state */
let level = 1;
let lives = START_LIVES;
let streak = 0;           // correct guesses in a row
let newBestNote = "";     // extra sentence like " New best streak: 4!" added to the result message

/* Saved state (loaded from localStorage in section 4) */
let settings = loadSettings();   // { instrument, scale, sfx }
let best = loadBest();           // { level, streak }

/* Current-round state */
let cfg = LEVELS[0];      // this level's settings (a row from the LEVELS list)
let original = [];        // the original melody (a list of scale steps)
let altered = [];         // the same melody with one note changed
let changedBeat = 0;      // which beat was changed (counting from 0, so 2 means beat 3)
let guess = null;         // null = no guess yet, otherwise the beat the player picked
let replaysLeft = Infinity;
let melodySecs = 0;       // how many seconds one melody lasts
let beatEls = [];         // the beat buttons on the page


/* ---------------------------------------------------------------------
   3. PAGE ELEMENTS
   Find each element in index.html by its id, so the code can change it.
   --------------------------------------------------------------------- */
const playBtn = document.getElementById("play");
const nextBtn = document.getElementById("next");
const restartBtn = document.getElementById("restart");
const statusEl = document.getElementById("status");
const beatsList = document.getElementById("beats");
const levelInfo = document.getElementById("levelInfo");
const livesInfo = document.getElementById("livesInfo");
const streakInfo = document.getElementById("streakInfo");
const bestLine = document.getElementById("bestLine");

const howBtn = document.getElementById("howBtn");
const howPanel = document.getElementById("howto");
const howTitle = document.getElementById("howtoTitle");
const practiceBtn = document.getElementById("practiceBtn");
const closeHowBtn = document.getElementById("closeHow");

const instrumentSel = document.getElementById("instrument");
const scaleSel = document.getElementById("scale");
const sfxBox = document.getElementById("sfx");
const resetBtn = document.getElementById("resetBests");


/* ---------------------------------------------------------------------
   4. SAVING (localStorage)
   localStorage is a small storage space inside the player's own browser.
   We save only options and two numbers: no names, nothing personal, nothing sent anywhere.
   It is wrapped in try/catch because some browsers (like private windows) block it.
   If it is blocked the game still works, it just forgets things when the page closes.
   --------------------------------------------------------------------- */

/* Read a saved value. Returns the fallback if nothing is saved or reading fails. */
function loadSaved(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

/* Save a value (turned into text with JSON). */
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    /* Blocked or full: ignore it and keep playing. */
  }
}

/* Load the options, checking each value is one we know, so a bad saved value can't break the game. */
function loadSettings() {
  const saved = loadSaved(KEYS.settings, null) || {};
  return {
    instrument: saved.instrument in INSTRUMENTS ? saved.instrument : "flute",
    scale: saved.scale in SCALES ? saved.scale : "major",
    sfx: saved.sfx !== false                     // sound effects are on unless saved as off
  };
}

/* Load the best scores, making sure they are real numbers. */
function loadBest() {
  const saved = loadSaved(KEYS.best, null) || {};
  return { level: Number(saved.level) || 0, streak: Number(saved.streak) || 0 };
}


/* ---------------------------------------------------------------------
   5. DRAWING HELPERS
   Small functions that update what the player sees.
   --------------------------------------------------------------------- */

/* Show a message in the status box. Skips the update if the message hasn't changed,
   otherwise a screen reader could keep repeating it 60 times a second. */
function setStatus(text) {
  if (text !== lastStatus) {
    statusEl.textContent = text;
    lastStatus = text;
  }
}

/* Redraw one beat button: its number, an optional small word under it
   (like "changed"), and its label for screen readers. */
function drawBeat(i, tagText) {
  const btn = beatEls[i];
  btn.innerHTML = "";                       // clear what's inside
  btn.append("" + (i + 1));                 // beats are numbered from 1 for the player
  if (tagText) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = tagText;
    btn.appendChild(tag);
  }
  /* A screen reader reads the aria-label instead of the button's contents. */
  btn.setAttribute("aria-label", "Beat " + (i + 1) + (tagText ? ", " + tagText : ""));
}

/* Build this round's beat buttons from scratch (one per note in the melody).
   They are real <button> elements, so Tab, Enter and Space work with no extra code.
   Each gets a RANDOM height. That is decoration and has nothing to do with the pitch. */
function buildBeats() {
  beatsList.innerHTML = "";                                    // remove last round's buttons
  beatsList.classList.toggle("compact", cfg.beats >= 9);       // tighter layout for long melodies
  beatEls = [];
  for (let i = 0; i < cfg.beats; i++) {
    const li = document.createElement("li");
    li.style.height = randInt(45, 100) + "%";                  // random height
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "beat";
    btn.disabled = true;                                       // locked until both melodies have played
    btn.addEventListener("click", () => handleGuess(i));       // clicking beat i makes a guess of i
    li.appendChild(btn);
    beatsList.appendChild(li);
    beatEls.push(btn);
    drawBeat(i, "");
  }
}

/* Update the Level / Lives / Streak boxes. */
function updateHud() {
  if (practice) {
    /* Practice rounds have no lives or streak, so say so and hide the streak box. */
    levelInfo.textContent = "Practice round";
    livesInfo.textContent = "No lives lost in practice";
    streakInfo.hidden = true;
    return;
  }
  streakInfo.hidden = false;
  levelInfo.textContent = "Level " + level + " of " + TOTAL_LEVELS;
  livesInfo.textContent = "Lives: " + lives + " ";
  /* Hearts are extra decoration. A full heart for each life left, an empty one for each lost.
     aria-hidden hides them from screen readers, since the number already says it. */
  const hearts = document.createElement("span");
  hearts.className = "hearts";
  hearts.setAttribute("aria-hidden", "true");
  hearts.textContent = "\u2665".repeat(lives) + "\u2661".repeat(START_LIVES - lives);
  livesInfo.appendChild(hearts);
  streakInfo.textContent = "Streak: " + streak;
}

/* Show the saved best scores under the Level / Lives / Streak boxes. */
function updateBestLine() {
  if (best.level === 0 && best.streak === 0) {
    bestLine.textContent = "No best scores yet. Play to set some!";
  } else {
    bestLine.textContent = "Best level: " + best.level + " of " + TOTAL_LEVELS + ". Best streak: " + best.streak + ".";
  }
}

/* ONE place decides which buttons are on or off and what they say, based on the phase.
   Every time the phase changes, we call this. */
function refreshControls() {
  const playing = phase === "playing original" || phase === "pause" || phase === "playing altered";

  /* Beat buttons are only clickable while waiting for a guess. */
  beatEls.forEach(btn => { btn.disabled = phase !== "waiting for guess"; });

  /* The Play / Replay button's label */
  if (phase === "idle") {
    playBtn.textContent = "Play both melodies";
  } else if (phase === "waiting for guess" && replaysLeft !== Infinity) {
    playBtn.textContent = "Replay (" + replaysLeft + " left)";
  } else {
    playBtn.textContent = "Replay";
  }
  /* It's locked while sound plays, or when you've used up your replays. */
  playBtn.disabled = playing || (phase === "waiting for guess" && replaysLeft === 0);

  /* The Next button only appears after a result that lets the game continue. */
  const moreToPlay = phase === "result" &&
    ["correct", "wrong", "practice-correct", "practice-wrong"].includes(outcome);
  nextBtn.hidden = !moreToPlay;
  nextBtn.textContent = practice ? "Another practice round" :
                        outcome === "correct" ? "Next level" : "Try level again";

  /* Restart appears after the first Play (or any time in practice), and is locked while sound plays.
     In practice it becomes the way to begin the real game. */
  restartBtn.hidden = !(started || practice);
  restartBtn.textContent = practice ? "Start the real game" : "Restart";
  restartBtn.disabled = playing;

  /* Don't let the player start a practice round, or change the sound, in the middle of a melody. */
  practiceBtn.disabled = playing;
  instrumentSel.disabled = playing;
  scaleSel.disabled = playing;
}


/* ---------------------------------------------------------------------
   6. SCHEDULING NOTES AND SOUND EFFECTS  (the new technique from my plan)
   We never use setTimeout to play notes, because it can drift by tens of
   milliseconds and make the beats uneven. Instead we give every note an
   exact start time on the AUDIO CLOCK (audioCtx.currentTime), which runs
   on the sound hardware and is very steady.
   --------------------------------------------------------------------- */

/* Get the sound engine, making it the first time. Browsers only allow sound after a click,
   so this is only ever called from inside a click or change handler. */
function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

/* Schedule one note: its pitch (freq), exact start time (when), how long it rings (length),
   the waveform (type) and how loud (volume). */
function scheduleNote(freq, when, length, type, volume) {
  const osc = audioCtx.createOscillator();   // the thing that makes the tone
  const gain = audioCtx.createGain();        // a volume knob
  osc.type = type;
  osc.frequency.value = freq;

  /* Fade in and out quickly. Starting or stopping a tone instantly makes a click.
     Very short notes get shorter fades so there's still room to sound. */
  const attack = Math.min(0.02, length * 0.15);
  const release = Math.min(0.08, length * 0.35);
  gain.gain.setValueAtTime(0, when);                              // silent at the start
  gain.gain.linearRampToValueAtTime(volume, when + attack);       // fade up
  gain.gain.setValueAtTime(volume, when + length - release);      // stay loud...
  gain.gain.linearRampToValueAtTime(0, when + length);            // ...then fade out

  osc.connect(gain);                         // tone -> volume knob
  gain.connect(audioCtx.destination);        // volume knob -> speakers
  osc.start(when);                           // begin at the exact time
  osc.stop(when + length);                   // end at the exact time
}

/* Schedule a whole melody using the chosen instrument. Note number i starts i beats
   after the melody's start, so every beat is exactly the same length. */
function scheduleMelody(steps, melodyStart) {
  const instrument = INSTRUMENTS[settings.instrument];
  steps.forEach((step, i) => {
    scheduleNote(stepToFreq(step), melodyStart + i * cfg.beat, cfg.beat * 0.85, instrument.type, instrument.volume);
  });
}

/* Play one of the jingles from the SFX list ("correct", "win", "wrong" or "gameover").
   Does nothing if sound effects are switched off in Options. */
function playSfx(kind) {
  if (!settings.sfx || !audioCtx || audioCtx.state !== "running") return;
  const jingle = SFX[kind];
  const t0 = audioCtx.currentTime + 0.05;
  jingle.notes.forEach((freq, i) => {
    scheduleNote(freq, t0 + i * jingle.gap, jingle.gap * 1.5, jingle.type, jingle.volume);
  });
}

/* A short four-note preview, so the player hears an Options change right away. */
function previewSound() {
  getAudioContext().resume().then(() => {
    if (audioCtx.state !== "running") return;
    const instrument = INSTRUMENTS[settings.instrument];
    const t0 = audioCtx.currentTime + 0.05;
    [0, 2, 4, 7].forEach((step, i) => {
      scheduleNote(stepToFreq(step), t0 + i * 0.25, 0.22, instrument.type, instrument.volume);
    });
  });
}


/* ---------------------------------------------------------------------
   7. PLAYING BOTH MELODIES  (used by Play and by Replay)
   --------------------------------------------------------------------- */
function playBoth() {
  getAudioContext();

  audioCtx.resume().then(() => {
    /* Failure case from my plan: if the browser still blocks sound, say so. */
    if (audioCtx.state !== "running") {
      setStatus("Your browser blocked the sound. Check that your volume is on, then press Play again.");
      return;
    }

    /* A replay before you've guessed uses up one of this level's replays. */
    if (phase === "waiting for guess" && replaysLeft !== Infinity) replaysLeft--;

    /* The first Play of a real round counts as reaching this level. Save it if it's a new best. */
    if (!practice && phase === "idle" && level > best.level) {
      best.level = level;
      save(KEYS.best, best);
      updateBestLine();
    }

    started = true;
    phase = "playing original";
    refreshControls();     // locks every button while the sound plays (failure case: clicking too early)

    /* Work out the times, then schedule BOTH melodies right now.
       The changed melody starts one melody-length plus one pause after the original.
       Nothing waits on a timer, so nothing can drift. */
    startTime = audioCtx.currentTime + 0.1;                       // tiny head start so the sound is ready
    scheduleMelody(original, startTime);
    scheduleMelody(altered, startTime + melodySecs + PAUSE_SECONDS);

    requestAnimationFrame(updateDisplay);                         // start watching the clock
  });
}


/* ---------------------------------------------------------------------
   8. KEEPING THE SCREEN IN SYNC WITH THE SOUND
   requestAnimationFrame runs a function once per screen refresh.
   Each time, we ask the audio clock how far along we are, then work out
   the phase, the message, and which beat to light up.
   --------------------------------------------------------------------- */
function updateDisplay() {
  const elapsed = audioCtx.currentTime - startTime;                      // seconds since the original began
  const alteredElapsed = elapsed - (melodySecs + PAUSE_SECONDS);         // seconds since the changed one began
  let current = -1;                                                      // which beat to light up (-1 = none)

  if (elapsed < melodySecs) {
    phase = "playing original";
    setStatus("Playing the original melody...");
    if (elapsed >= 0) current = Math.floor(elapsed / cfg.beat);          // which beat are we on?
  } else if (alteredElapsed < 0) {
    phase = "pause";
    setStatus("Get ready. The second version is next...");
  } else if (alteredElapsed < melodySecs) {
    phase = "playing altered";
    setStatus("Playing the second version. Listen for the changed note...");
    current = Math.floor(alteredElapsed / cfg.beat);
  } else {
    finishPlaying();                                                     // both melodies are done
    return;                                                              // stop the loop
  }

  /* Light up only the current beat (adds the "active" class to it, removes it from the others). */
  beatEls.forEach((btn, i) => btn.classList.toggle("active", i === current));
  requestAnimationFrame(updateDisplay);                                  // check again next frame
}

/* Both melodies are done. Either wait for a guess,
   or (a replay after a result) just show the result again. */
function finishPlaying() {
  beatEls.forEach(btn => btn.classList.remove("active"));

  if (guess === null) {
    phase = "waiting for guess";
    refreshControls();                       // unlocks the beat buttons
    setStatus("Which beat changed? Choose a beat.");
    beatEls[0].focus();                      // keyboard users land on beat 1
  } else {
    phase = "result";
    refreshControls();
    setStatus(resultMessage());
    playBtn.focus();
  }
}


/* ---------------------------------------------------------------------
   9. THE GUESS AND THE RESULT
   --------------------------------------------------------------------- */

/* Builds the sentence shown after a guess, based on the outcome. */
function resultMessage() {
  const answer = changedBeat + 1;      // +1 because players count from 1, code counts from 0
  const mine = guess + 1;
  if (outcome === "practice-correct") {
    return "Correct! Beat " + answer + " was the changed note. That was practice, so nothing counts. Try another, or start the real game.";
  }
  if (outcome === "practice-wrong") {
    return "Not quite, it was beat " + answer + ". You chose beat " + mine + ". Practice never costs lives. Try another, or start the real game.";
  }
  if (outcome === "won") {
    return "Correct! Beat " + answer + " was the changed note. You cleared all " + TOTAL_LEVELS + " levels. You win!" + newBestNote;
  }
  if (outcome === "correct") {
    return "Correct! Beat " + answer + " was the changed note. Level " + level + " cleared." + newBestNote;
  }
  if (outcome === "gameover") {
    return "Not quite, it was beat " + answer + ". You chose beat " + mine + ". Game over: you reached level " + level + ". Restart to try again.";
  }
  return "Not quite, it was beat " + answer + ". You chose beat " + mine + ". You have " + lives +
         (lives === 1 ? " life" : " lives") + " left. Try this level again with a new melody.";
}

/* Runs when the player clicks a beat button. i is the beat they picked. */
function handleGuess(i) {
  /* Safety check: ignore a click at any other time (backs up the locked buttons). */
  if (phase !== "waiting for guess") return;
  guess = i;
  const right = i === changedBeat;
  newBestNote = "";

  /* Compare the guess to the changed beat, then update the game. */
  if (practice) {
    outcome = right ? "practice-correct" : "practice-wrong";    // nothing counts in practice
  } else if (right) {
    streak++;
    outcome = level === TOTAL_LEVELS ? "won" : "correct";       // correct on level 10 means you win
    if (streak > best.streak) {                                 // a new best streak? remember it
      best.streak = streak;
      save(KEYS.best, best);
      if (streak >= 2) newBestNote = " New best streak: " + streak + "!";
    }
  } else {
    streak = 0;
    lives--;
    outcome = lives === 0 ? "gameover" : "wrong";
  }
  phase = "result";

  /* Mark the answer: the changed beat gets the word "changed" and the "answer" style (double border).
     A wrong guess gets "your guess" and the "guess" style (dashed border). */
  drawBeat(changedBeat, "changed");
  beatEls[changedBeat].classList.add("answer");
  if (!right) {
    drawBeat(i, "your guess");
    beatEls[i].classList.add("guess");
  }

  /* Play the matching jingle. */
  if (right) playSfx(outcome === "won" ? "win" : "correct");
  else playSfx(outcome === "gameover" ? "gameover" : "wrong");

  updateHud();
  updateBestLine();
  refreshControls();
  setStatus(resultMessage());
  /* The beat just clicked became locked, so move keyboard focus to the main next action. */
  (nextBtn.hidden ? restartBtn : nextBtn).focus();
}


/* ---------------------------------------------------------------------
   10. ROUNDS, LEVELS AND THE PRACTICE ROUND
   --------------------------------------------------------------------- */

/* Set up a fresh round for the current level. */
function newRound() {
  cfg = LEVELS[level - 1];                       // levels count from 1, the list counts from 0
  original = makeMelody(cfg.beats);
  melodySecs = cfg.beats * cfg.beat;

  /* Change ONE random note by exactly cfg.steps scale steps, up or down (whichever stays in range). */
  changedBeat = randInt(0, cfg.beats - 1);
  const old = original[changedBeat];
  const options = [];
  if (old + cfg.steps <= 14) options.push(old + cfg.steps);
  if (old - cfg.steps >= 0) options.push(old - cfg.steps);
  altered = original.slice();                    // slice() makes a COPY, so the original stays untouched
  altered[changedBeat] = options[randInt(0, options.length - 1)];

  /* Reset the round's state. */
  guess = null;
  outcome = null;
  phase = "idle";
  replaysLeft = cfg.replays;
  newBestNote = "";

  /* Beating your furthest level so far gets a shout-out (practice doesn't count).
     The best level is only saved once you press Play, in playBoth(). */
  const levelNote = (!practice && level > 1 && level > best.level) ? " New best level!" : "";

  buildBeats();
  updateHud();
  updateBestLine();
  refreshControls();

  if (practice) {
    setStatus("Practice round. Nothing counts here. Press Play, listen, then pick the beat that changed.");
  } else {
    const replayNote = cfg.replays === Infinity ? "" :
      " You can replay " + cfg.replays + (cfg.replays === 1 ? " time" : " times") + " before you guess.";
    setStatus("Level " + level + " of " + TOTAL_LEVELS + "." + levelNote + replayNote + " Press Play.");
  }
}

/* The Next / Try again / Another practice round button. */
function goNext() {
  if (outcome === "correct") level++;            // after a wrong guess (or in practice), the SAME level starts again
  newRound();
  playBtn.focus();
}

/* The Restart button (also "Start the real game" after practice): a brand new game from level 1. */
function restart() {
  practice = false;
  level = 1;
  lives = START_LIVES;
  streak = 0;
  started = false;
  newRound();
  playBtn.focus();
}

/* The practice round: a level-1 round where nothing counts. It ends any game in progress. */
function startPractice() {
  practice = true;
  level = 1;
  lives = START_LIVES;
  streak = 0;
  started = false;
  closeHowTo(false);
  newRound();
  playBtn.focus();
}


/* ---------------------------------------------------------------------
   11. THE HOW TO PLAY PANEL AND THE OPTIONS
   --------------------------------------------------------------------- */

/* Open the How to play panel. If moveFocus is true, keyboard focus moves to its heading
   so screen reader users know it opened. */
function openHowTo(moveFocus) {
  howPanel.hidden = false;
  howBtn.setAttribute("aria-expanded", "true");
  if (moveFocus) howTitle.focus();
}

/* Close it. If moveFocus is true, focus goes back to the How to play button. */
function closeHowTo(moveFocus) {
  howPanel.hidden = true;
  howBtn.setAttribute("aria-expanded", "false");
  if (moveFocus) howBtn.focus();
}

/* Fill a dropdown with one <option> per entry in a table (INSTRUMENTS or SCALES),
   and select the saved one. */
function fillSelect(selectEl, table, selectedKey) {
  selectEl.innerHTML = "";
  for (const key in table) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = table[key].label;
    selectEl.appendChild(option);
  }
  selectEl.value = selectedKey;
}

/* Set up the Options controls and connect them. */
fillSelect(instrumentSel, INSTRUMENTS, settings.instrument);
fillSelect(scaleSel, SCALES, settings.scale);
sfxBox.checked = settings.sfx;

instrumentSel.addEventListener("change", () => {
  settings.instrument = instrumentSel.value;
  save(KEYS.settings, settings);
  previewSound();                                // let the player hear the new sound
});

scaleSel.addEventListener("change", () => {
  settings.scale = scaleSel.value;
  save(KEYS.settings, settings);
  previewSound();
});

sfxBox.addEventListener("change", () => {
  settings.sfx = sfxBox.checked;
  save(KEYS.settings, settings);
});

resetBtn.addEventListener("click", () => {
  /* confirm() shows a built-in yes/no box, so scores can't be wiped by accident. */
  if (confirm("Reset your best level and best streak?")) {
    best = { level: 0, streak: 0 };
    save(KEYS.best, best);
    updateBestLine();
  }
});

/* How to play: the button toggles the panel, Close closes it, Escape closes it too. */
howBtn.addEventListener("click", () => {
  if (howPanel.hidden) openHowTo(true);
  else closeHowTo(true);
});
closeHowBtn.addEventListener("click", () => closeHowTo(true));
howPanel.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeHowTo(true);
});
practiceBtn.addEventListener("click", startPractice);


/* ---------------------------------------------------------------------
   12. START
   Connect each game button to its function, set up the first round,
   and show the How to play panel the very first time someone visits.
   --------------------------------------------------------------------- */
playBtn.addEventListener("click", playBoth);
nextBtn.addEventListener("click", goNext);
restartBtn.addEventListener("click", restart);
newRound();

if (!loadSaved(KEYS.seenHowTo, false)) {
  openHowTo(false);                     // open it, but don't steal keyboard focus on page load
  save(KEYS.seenHowTo, true);
}
