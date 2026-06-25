const $ = (selector) => document.querySelector(selector);

const els = {
  input: $("#wordInput"),
  counter: $("#wordCounter"),
  voice: $("#voiceSelect"),
  voiceState: $("#voiceState"),
  speed: $("#speedRange"),
  speedValue: $("#speedValue"),
  repeatValue: $("#repeatValue"),
  repeatNumber: $("#repeatNumber"),
  gap: $("#gapRange"),
  gapValue: $("#gapValue"),
  empty: $("#emptyState"),
  list: $("#wordList"),
  preview: $("#previewFirstButton"),
  play: $("#playButton"),
  previous: $("#previousButton"),
  next: $("#nextButton"),
  stop: $("#stopButton"),
  player: $("#player"),
  playingLabel: $("#playingLabel"),
  playingWord: $("#playingWord"),
  progressText: $("#progressText"),
  progressBar: $("#progressBar"),
  toast: $("#toast"),
};

let words = [];
let repeatCount = 3;
let currentIndex = 0;
let currentRepeat = 0;
let isPlaying = false;
let isPaused = false;
let session = 0;
let gapTimer = null;
let voices = [];
let toastTimer = null;

const synth = window.speechSynthesis;

function parseWords(value) {
  return value
    .split(/[\n,，;；]+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 200);
}

function escapeHTML(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function selectedVoice() {
  return voices.find((voice) => voice.voiceURI === els.voice.value) || voices[0] || null;
}

function loadVoices() {
  const allVoices = synth?.getVoices?.() || [];
  voices = allVoices.filter((voice) => /^en-US/i.test(voice.lang));
  if (!voices.length) voices = allVoices.filter((voice) => /^en/i.test(voice.lang));

  els.voice.innerHTML = "";
  if (!voices.length) {
    const option = document.createElement("option");
    option.textContent = "系统默认美式英语";
    option.value = "";
    els.voice.appendChild(option);
    els.voiceState.textContent = "使用系统声音";
    return;
  }

  voices
    .sort((a, b) => Number(b.default) - Number(a.default))
    .forEach((voice) => {
      const option = document.createElement("option");
      option.value = voice.voiceURI;
      option.textContent = `${voice.name}${voice.default ? " · 默认" : ""}`;
      els.voice.appendChild(option);
    });
  els.voiceState.textContent = `${voices.length} 个可用声音`;
}

function updateWords() {
  const nextWords = parseWords(els.input.value);
  const changed = nextWords.join("\n") !== words.join("\n");
  words = nextWords;
  els.counter.textContent = `${words.length} 个单词`;
  els.empty.style.display = words.length ? "none" : "block";
  els.list.style.display = words.length ? "grid" : "none";
  els.preview.disabled = !words.length;
  [els.play, els.previous, els.next, els.stop].forEach((button) => button.disabled = !words.length);

  els.list.innerHTML = words.map((word, index) => `
    <div class="word-card${isPlaying && index === currentIndex ? " active" : ""}" data-index="${index}">
      <span class="word-index">${String(index + 1).padStart(2, "0")}</span>
      <strong title="${escapeHTML(word)}">${escapeHTML(word)}</strong>
      <span>× ${repeatCount}</span>
      <button type="button" data-speak="${index}" aria-label="试听 ${escapeHTML(word)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z"/></svg>
      </button>
    </div>
  `).join("");

  if (changed && isPlaying) stopPlayback();
  if (!isPlaying) {
    currentIndex = Math.min(currentIndex, Math.max(0, words.length - 1));
    updatePlayer();
  }
}

function updatePlayer() {
  if (!words.length) {
    els.playingLabel.textContent = "准备就绪";
    els.playingWord.textContent = "等待添加单词";
    els.progressText.textContent = "0 / 0";
    els.progressBar.style.width = "0%";
    return;
  }
  els.playingLabel.textContent = isPlaying ? `第 ${currentRepeat + 1} / ${repeatCount} 遍` : "准备播放";
  els.playingWord.textContent = words[currentIndex] || words[0];
  els.progressText.textContent = `${currentIndex + 1} / ${words.length}`;
  const progress = isPlaying
    ? ((currentIndex * repeatCount + currentRepeat) / (words.length * repeatCount)) * 100
    : (currentIndex / words.length) * 100;
  els.progressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  document.querySelectorAll(".word-card").forEach((card, index) => {
    card.classList.toggle("active", isPlaying && index === currentIndex);
  });
}

function speakOnce(text, onEnd, token = session) {
  if (!synth || !("SpeechSynthesisUtterance" in window)) {
    showToast("当前浏览器不支持语音合成，请使用 Chrome、Edge 或 Safari");
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = Number(els.speed.value);
  utterance.pitch = 1;
  const voice = selectedVoice();
  if (voice) utterance.voice = voice;
  utterance.onend = () => token === session && onEnd?.();
  utterance.onerror = (event) => {
    if (event.error !== "canceled" && event.error !== "interrupted") {
      isPlaying = false;
      els.player.classList.remove("is-playing");
      showToast("发音失败，请尝试更换发音人");
    }
  };
  synth.speak(utterance);
}

function continueQueue(token) {
  if (!isPlaying || token !== session || !words[currentIndex]) return;
  updatePlayer();
  speakOnce(words[currentIndex], () => {
    if (!isPlaying || token !== session) return;
    currentRepeat += 1;
    if (currentRepeat >= repeatCount) {
      currentRepeat = 0;
      currentIndex += 1;
    }
    if (currentIndex >= words.length) {
      finishPlayback();
      return;
    }
    updatePlayer();
    gapTimer = setTimeout(() => continueQueue(token), Number(els.gap.value) * 1000);
  }, token);
}

function startPlayback(index = currentIndex) {
  if (!words.length) return;
  if (isPaused) {
    synth.resume();
    isPaused = false;
    isPlaying = true;
    els.player.classList.add("is-playing");
    els.playingLabel.textContent = `第 ${currentRepeat + 1} / ${repeatCount} 遍`;
    return;
  }
  session += 1;
  clearTimeout(gapTimer);
  synth.cancel();
  currentIndex = Math.max(0, Math.min(index, words.length - 1));
  currentRepeat = 0;
  isPlaying = true;
  isPaused = false;
  els.player.classList.add("is-playing");
  continueQueue(session);
}

function pausePlayback() {
  if (!isPlaying) return;
  synth.pause();
  isPaused = true;
  isPlaying = false;
  els.player.classList.remove("is-playing");
  els.playingLabel.textContent = "已暂停";
}

function stopPlayback(resetIndex = true) {
  session += 1;
  clearTimeout(gapTimer);
  synth?.cancel();
  isPlaying = false;
  isPaused = false;
  currentRepeat = 0;
  if (resetIndex) currentIndex = 0;
  els.player.classList.remove("is-playing");
  updatePlayer();
}

function finishPlayback() {
  session += 1;
  isPlaying = false;
  isPaused = false;
  currentIndex = 0;
  currentRepeat = 0;
  els.player.classList.remove("is-playing");
  els.progressBar.style.width = "100%";
  els.playingLabel.textContent = "播放完成";
  els.playingWord.textContent = `${words.length} 个单词已完成`;
  setTimeout(() => {
    if (!isPlaying) updatePlayer();
  }, 1800);
}

function previewWord(index) {
  stopPlayback(false);
  currentIndex = index;
  updatePlayer();
  speakOnce(words[index], () => {
    els.playingLabel.textContent = "试听完成";
  });
  els.playingLabel.textContent = "单词试听";
}

els.input.addEventListener("input", updateWords);
els.speed.addEventListener("input", () => {
  els.speedValue.textContent = `${Number(els.speed.value).toFixed(1)}×`;
});
els.gap.addEventListener("input", () => {
  els.gapValue.textContent = `${Number(els.gap.value).toFixed(1)} 秒`;
});
$("#minusRepeat").addEventListener("click", () => {
  repeatCount = Math.max(1, repeatCount - 1);
  els.repeatNumber.textContent = repeatCount;
  els.repeatValue.textContent = `${repeatCount} 遍`;
  updateWords();
});
$("#plusRepeat").addEventListener("click", () => {
  repeatCount = Math.min(20, repeatCount + 1);
  els.repeatNumber.textContent = repeatCount;
  els.repeatValue.textContent = `${repeatCount} 遍`;
  updateWords();
});
$("#exampleButton").addEventListener("click", () => {
  els.input.value = "serendipity\nresilient\neloquent\nmeticulous\nwanderlust";
  updateWords();
  els.input.focus();
});
$("#clearButton").addEventListener("click", () => {
  els.input.value = "";
  stopPlayback();
  updateWords();
  els.input.focus();
});
els.list.addEventListener("click", (event) => {
  const button = event.target.closest("[data-speak]");
  if (button) previewWord(Number(button.dataset.speak));
});
els.preview.addEventListener("click", () => previewWord(0));
els.play.addEventListener("click", () => isPlaying ? pausePlayback() : startPlayback());
els.stop.addEventListener("click", () => stopPlayback());
els.previous.addEventListener("click", () => startPlayback(Math.max(0, currentIndex - 1)));
els.next.addEventListener("click", () => startPlayback(Math.min(words.length - 1, currentIndex + 1)));
$("#themeButton").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("wordflow-theme", document.body.classList.contains("dark") ? "dark" : "light");
});

if (localStorage.getItem("wordflow-theme") === "dark") document.body.classList.add("dark");
loadVoices();
if (synth) synth.onvoiceschanged = loadVoices;
updateWords();
window.addEventListener("beforeunload", () => synth?.cancel());
