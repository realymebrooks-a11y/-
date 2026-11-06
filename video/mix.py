# 合成音轨：配音 + 代码生成的 8-bit 背景音乐 + 音效，配音时背景音乐自动压低
import json, numpy as np, soundfile as sf

SR = 44100
B = 'video/build/'
tl = json.load(open(B + 'timeline.json'))
sfx = json.load(open(B + 'sfx.json'))
N = int((tl['end'] + 0.5) * SR)
voice = np.zeros(N); music = np.zeros(N); fx = np.zeros(N)

def put(buf, t, x):
    i = int(t * SR); x = x[: max(0, N - i)]; buf[i:i + len(x)] += x

# ---- 配音 ----
for s in tl['segs']:
    a, sr = sf.read(f"{B}audio/{s['id']}.wav")
    if sr != SR: a = np.interp(np.arange(0, len(a), sr / SR), np.arange(len(a)), a)
    put(voice, s['start'], a * 0.95)

# ---- 8-bit 背景音乐 ----
def sq(f, d, duty=0.5, vol=0.2):
    t = np.arange(int(d * SR)) / SR
    w = np.where((t * f) % 1 < duty, 1.0, -1.0)
    env = np.minimum(1, t / 0.005) * np.exp(-t * 3.0)
    return w * env * vol
def tri(f, d, vol=0.25):
    t = np.arange(int(d * SR)) / SR
    w = 2 * np.abs(2 * ((t * f) % 1) - 1) - 1
    return w * np.minimum(1, (d - t) / 0.02) * vol
def note(m): return 440 * 2 ** ((m - 69) / 12)
def sweep_kick():
    tt = np.arange(int(0.12 * SR)) / SR
    f = 120 * np.exp(-tt * 25) + 45
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 18) * 0.25

bpm = 118; beat = 60 / bpm
prog = [(60, [0, 4, 7]), (57, [0, 3, 7]), (53, [0, 4, 7]), (55, [0, 4, 7])]   # C - Am - F - G
# 8 小节一句的主旋律（C 大调五声），第二遍高八度
mel = [72, 76, 79, 76, 77, 76, 74, None, 72, 74, 76, 72, 69, 72, None, None,
       72, 76, 79, 81, 79, 77, 76, None, 74, 76, 77, 74, 79, 79, 79, None]
t = 0; bar = 0
while t < tl['end'] + 1:
    root, ch = prog[bar % 4]
    for b in range(4):                                     # 低音：每拍一个三角波
        put(music, t + b * beat, tri(note(root - 24 + (7 if b % 2 else 0)), beat * 0.9, 0.22))
    for k in range(8):                                     # 琶音：八分音符方波
        m = root + 12 + ch[k % 3] + (12 if k >= 6 else 0)
        put(music, t + k * beat / 2, sq(note(m), beat / 2 * 0.95, 0.25, 0.05))
    if bar >= 2:                                           # 主旋律从第 3 小节进入
        for k in range(4):
            n = mel[((bar - 2) * 4 + k) % len(mel)]
            if n: put(music, t + k * beat, sq(note(n + (12 if (bar // 8) % 2 else 0)), beat * 0.9, 0.125, 0.055))
    for b in range(4):                                     # 鼓点：底鼓 + 军鼓
        if b % 2 == 0: put(music, t + b * beat, sweep_kick())
        else:
            n = np.random.RandomState(bar * 10 + b).randn(int(0.09 * SR)) * np.exp(-np.arange(int(0.09 * SR)) / SR * 35) * 0.06
            put(music, t + b * beat, n)
    t += 4 * beat; bar += 1

# ---- 音效 ----
def sweep(f0, f1, d, vol=0.25, duty=0.5):
    tt = np.arange(int(d * SR)) / SR
    f = f0 + (f1 - f0) * tt / d
    ph = np.cumsum(f) / SR
    return np.where(ph % 1 < duty, 1.0, -1.0) * np.exp(-tt * 4) * vol
def noise(d, vol=0.2, decay=10):
    tt = np.arange(int(d * SR)) / SR
    return np.random.RandomState(1).randn(len(tt)) * np.exp(-tt * decay) * vol
pop = lambda f0, f1: np.concatenate([sq(note(f0), 0.06, 0.5, 0.12), sq(note(f1), 0.1, 0.5, 0.12)])
SFX = {
    'click': sq(1800, 0.04, 0.5, 0.10),
    'hat': sweep(900, 220, 0.35, 0.18),
    'changes': pop(76, 83),
    'showApp': np.concatenate([sq(note(n), 0.07, 0.5, 0.12) for n in (60, 64, 67, 72)]),
    'chapter': np.concatenate([sq(note(n), 0.08, 0.25, 0.1) for n in (79, 84)]),
    'bubble': pop(81, 88),
    'magnify': sweep(300, 1200, 0.6, 0.08, 0.25),
    'clue': np.concatenate([sq(note(n), 0.09, 0.5, 0.12) for n in (72, 76, 79, 84, 88)]),
    'solved': np.concatenate([sweep(160, 60, 0.25, 0.4), np.zeros(10)]) + np.pad(noise(0.2, 0.25, 20), (0, int(0.25 * SR) + 10 - int(0.2 * SR))),
    'coins': np.concatenate([np.concatenate([sq(note(88), 0.06, 0.5, 0.12), sq(note(95), 0.18, 0.5, 0.12)]) for _ in range(3)]),
    'loop': sweep(400, 800, 0.4, 0.08),
    'arch': noise(0.5, 0.10, 6),
    'outro': np.concatenate([sq(note(n), 0.12, 0.5, 0.13) for n in (72, 76, 79, 84, 79, 84)]),
}
for e in sfx:
    if e['name'] in SFX: put(fx, e['t'], SFX[e['name']])

# ---- 闪避：说话时背景音乐压低 ----
k = int(0.05 * SR)
env = np.convolve(np.abs(voice), np.ones(k) / k, mode='same')
duck = np.where(env > 0.01, 0.28, 1.0)
duck = np.convolve(duck, np.ones(int(0.3 * SR)) / int(0.3 * SR), mode='same')
fade = np.ones(N); fl = int(2 * SR); fade[-fl:] = np.linspace(1, 0, fl)
mix = voice + music * duck * 0.6 * fade + fx * 0.8
mix = mix / max(1.0, np.abs(mix).max() / 0.95)
sf.write(B + 'audio.wav', mix, SR)
print('ok', N / SR)
