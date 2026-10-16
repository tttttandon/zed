/* =====================================================================
   FIND THE NOTE! - script.js
   This file is the BEHAVIOR of the game. (index.html is the structure,
   style.css is the look.)

   How a round works, in plain words:
     1. A random melody is made for the current level, plus a copy of it
        with ONE note changed.
     2. Player presses Play. Both melodies are scheduled on the audio clock.
     3. The beat buttons unlock. Player clicks the beat they think changed.
     4. The game checks the guess, updates lives / streak / level,
        and offers Replay, Next level (or Try again), and Restart.

   Sections in this file:
     1. Data: the levels, the notes, the random helpers
     2. State: the variables that change as the game runs
     3. Page elements: grabbing things from index.html
     4. Drawing helpers: status text, beat buttons, info boxes, which buttons are on
     5. Scheduling notes (the new technique: the audio clock)
     6. Playing both melodies
     7. Keeping the screen in sync with the sound
     8. The guess and the result
     9. Rounds and levels
    10. Start
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

/* Notes are stored as "scale steps" in C major:
   0 = C, 1 = D, 2 = E, 3 = F, 4 = G, 5 = A, 6 = B, 7 = the next C up, and so on.
   They only become real sound frequencies (in Hertz) at the moment they are played.
   MAJOR_SEMITONES says how far each step of the scale is above C, in half-steps. */
const MAJOR_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

function stepToFreq(step) {
  /* Math.floor(step / 7) counts how many full octaves up we are (7 steps per octave).
     step % 7 is the position inside the octave. 12 half-steps make one octave. */
  const semitones = 12 * Math.floor(step / 7) + MAJOR_SEMITONES[step % 7];
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
     "correct", "wrong", "gameover", "won"
   --------------------------------------------------------------------- */
let audioCtx = null;      // the Web Audio "sound engine"; created on the first click
let phase = "idle";
let outcome = null;
let started = false;      // has the player pressed Play yet in this game?
let startTime = 0;        // the audio-clock time when the original melody began
let lastStatus = "";      // the last message shown, so we don't rewrite the same one

/* Whole-game state */
let level = 1;
let lives = START_LIVES;
let streak = 0;           // correct guesses in a row

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


/* ---------------------------------------------------------------------
   4. DRAWING HELPERS
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
  const moreToPlay = phase === "result" && (outcome === "correct" || outcome === "wrong");
  nextBtn.hidden = !moreToPlay;
  nextBtn.textContent = outcome === "correct" ? "Next level" : "Try level again";

  /* Restart appears after the first Play, and is locked while sound plays. */
  restartBtn.hidden = !started;
  restartBtn.disabled = playing;
}


/* ---------------------------------------------------------------------
   5. SCHEDULING NOTES  (the new technique from my plan)
   We never use setTimeout to play notes, because it can drift by tens of
   milliseconds and make the beats uneven. Instead we give every note an
   exact start time on the AUDIO CLOCK (audioCtx.currentTime), which runs
   on the sound hardware and is very steady.
   --------------------------------------------------------------------- */

/* Schedule one note: its pitch (freq), exact start time (when), and how long it rings (length). */
function scheduleNote(freq, when, length) {
  const osc = audioCtx.createOscillator();   // the thing that makes the tone
  const gain = audioCtx.createGain();        // a volume knob
  osc.type = "triangle";                     // a soft, flute-like sound
  osc.frequency.value = freq;

  /* Fade in and out quickly. Starting or stopping a tone instantly makes a click.
     Very short notes get shorter fades so there's still room to sound. */
  const attack = Math.min(0.02, length * 0.15);
  const release = Math.min(0.08, length * 0.35);
  gain.gain.setValueAtTime(0, when);                              // silent at the start
  gain.gain.linearRampToValueAtTime(0.4, when + attack);          // fade up
  gain.gain.setValueAtTime(0.4, when + length - release);         // stay loud...
  gain.gain.linearRampToValueAtTime(0, when + length);            // ...then fade out

  osc.connect(gain);                         // tone -> volume knob
  gain.connect(audioCtx.destination);        // volume knob -> speakers
  osc.start(when);                           // begin at the exact time
  osc.stop(when + length);                   // end at the exact time
}

/* Schedule a whole melody. Note number i starts i beats after the melody's start,
   so every beat is exactly the same length. */
function scheduleMelody(steps, melodyStart) {
  steps.forEach((step, i) => {
    scheduleNote(stepToFreq(step), melodyStart + i * cfg.beat, cfg.beat * 0.85);
  });
}


/* ---------------------------------------------------------------------
   6. PLAYING BOTH MELODIES  (used by Play and by Replay)
   --------------------------------------------------------------------- */
function playBoth() {
  /* Browsers only allow sound after a click, so the sound engine is made here, on the click. */
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  audioCtx.resume().then(() => {
    /* Failure case from my plan: if the browser still blocks sound, say so. */
    if (audioCtx.state !== "running") {
      setStatus("Your browser blocked the sound. Check that your volume is on, then press Play again.");
      return;
    }

    /* A replay before you've guessed uses up one of this level's replays. */
    if (phase === "waiting for guess" && replaysLeft !== Infinity) replaysLeft--;

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
   7. KEEPING THE SCREEN IN SYNC WITH THE SOUND
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
   8. THE GUESS AND THE RESULT
   --------------------------------------------------------------------- */

/* Builds the sentence shown after a guess, based on the outcome. */
function resultMessage() {
  const answer = changedBeat + 1;      // +1 because players count from 1, code counts from 0
  const mine = guess + 1;
  if (outcome === "won") {
    return "Correct! Beat " + answer + " was the changed note. You cleared all " + TOTAL_LEVELS + " levels. You win!";
  }
  if (outcome === "correct") {
    return "Correct! Beat " + answer + " was the changed note. Level " + level + " cleared.";
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

  /* Compare the guess to the changed beat, then update the game. */
  if (i === changedBeat) {
    streak++;
    outcome = level === TOTAL_LEVELS ? "won" : "correct";    // correct on level 10 means you win
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
  if (i !== changedBeat) {
    drawBeat(i, "your guess");
    beatEls[i].classList.add("guess");
  }

  updateHud();
  refreshControls();
  setStatus(resultMessage());
  /* The beat just clicked became locked, so move keyboard focus to the main next action. */
  (nextBtn.hidden ? restartBtn : nextBtn).focus();
}


/* ---------------------------------------------------------------------
   9. ROUNDS AND LEVELS
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

  buildBeats();
  updateHud();
  refreshControls();

  const replayNote = cfg.replays === Infinity ? "" :
    " You can replay " + cfg.replays + (cfg.replays === 1 ? " time" : " times") + " before you guess.";
  setStatus("Level " + level + " of " + TOTAL_LEVELS + "." + replayNote + " Press Play.");
}

/* The Next / Try again button. */
function goNext() {
  if (outcome === "correct") level++;            // after a wrong guess, the SAME level starts again
  newRound();
  playBtn.focus();
}

/* The Restart button: a brand new game from level 1. */
function restart() {
  level = 1;
  lives = START_LIVES;
  streak = 0;
  started = false;
  newRound();
  playBtn.focus();
}


/* ---------------------------------------------------------------------
   10. START
   Connect each button to its function, then set up the first round.
   --------------------------------------------------------------------- */
playBtn.addEventListener("click", playBoth);
nextBtn.addEventListener("click", goNext);
restartBtn.addEventListener("click", restart);
newRound();
