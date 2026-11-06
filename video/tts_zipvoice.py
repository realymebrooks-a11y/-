# ZipVoice（真人语料训练的零样本 TTS）：用 D 播音腔音色做参考音，按整句合成，句间留自然停顿
import re, subprocess, numpy as np, sherpa_onnx, soundfile as sf
Z = '/opt/tts/sherpa-onnx-zipvoice-distill-zh-en-emilia'
LEX = '/opt/tts/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia/lexicon.txt'
tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
    zipvoice=sherpa_onnx.OfflineTtsZipvoiceModelConfig(tokens=f'{Z}/tokens.txt', encoder=f'{Z}/text_encoder.onnx',
        decoder=f'{Z}/fm_decoder.onnx', vocoder=f'{Z}/vocos_24khz.onnx', lexicon=LEX), num_threads=4)))
PROMPT_WAV = '/opt/tts/prompt_d.wav'
PROMPT_TXT = open('/opt/tts/prompt_d.txt').read().strip()
_p, _psr = sf.read(PROMPT_WAV, dtype='float32')
GAP = {'。': 0.32, '！': 0.32, '？': 0.36}

def trim(x, sr, th=0.01):
    idx = np.where(np.abs(x) > th)[0]
    if not len(idx): return x
    return x[max(0, idx[0] - int(0.03 * sr)): idx[-1] + int(0.08 * sr)]

def synth(text, speed=1.0, steps=8):
    parts = [p for p in re.findall(r'[^。！？]+[。！？]?', text) if p.strip()]
    out = []; sr = 24000
    for p in parts:
        g = tts.generate(p, PROMPT_TXT, _p.tolist(), _psr, speed, steps); sr = g.sample_rate
        out.append(trim(np.array(g.samples, dtype=np.float32), sr))
        out.append(np.zeros(int(GAP.get(p[-1], 0.25) * sr), np.float32))
    return np.concatenate(out[:-1] + [np.zeros(int(0.1 * sr), np.float32)]), sr

FX = ('highpass=f=90,equalizer=f=3500:t=q:w=1.2:g=2,'
      'acompressor=threshold=-20dB:ratio=2.5:attack=8:release=100:makeup=2,loudnorm=I=-16:TP=-1.5:LRA=9,aresample=44100')
def say(text, out, speed=1.0, steps=8):
    x, sr = synth(text, speed, steps)
    raw = out + '.raw.wav'; sf.write(raw, x, sr)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', raw, '-af', FX, '-ac', '1', out], check=True)
    subprocess.run(['rm', raw]); return sf.info(out).duration
