# 计算每段语音的音量包络（30fps），用于像素形象口型同步
import json, numpy as np, soundfile as sf
d = json.load(open('video/build/durations.json'))
env = {}
for k in d:
    a, sr = sf.read(f'video/build/audio/{k}.wav')
    hop = sr // 30
    rms = [float(np.sqrt(np.mean(a[i:i+hop]**2))) for i in range(0, len(a), hop)]
    m = max(rms) or 1
    env[k] = [round(x / m, 2) for x in rms]
json.dump(env, open('video/build/envelope.json', 'w'))
print({k: len(v) for k, v in env.items()})
