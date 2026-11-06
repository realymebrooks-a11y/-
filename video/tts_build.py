# 用本地 ZipVoice（D 播音腔音色）（sherpa-onnx）逐句合成每段讲解，并输出时长表
import json, sys
sys.path.insert(0, '/opt/tts')
from tts4 import say
VOICE = dict(speed=0.92)
SUB = [('AI', '诶爱'), ('DeepSeek', 'deep seek'), ('「', ''), ('」', ''), ('Claude', '克劳德'), ('；', '，')]
segs = json.load(open('video/script.json'))
out = {}
for s in segs:
    t = s['zh']
    for a, b in SUB: t = t.replace(a, b)
    out[s['id']] = round(say(t, f"video/build/audio/{s['id']}.wav", **VOICE), 3)
    print(s['id'], out[s['id']], len(s['zh']))
json.dump(out, open('video/build/durations.json', 'w'), indent=1)
print('total', sum(out.values()))
