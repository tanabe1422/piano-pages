# piano-pages

口を閉じた「ん」で、鳴っている高さに合わせる練習用ページ。

公開先は GitHub Pages である。

- [index.html](index.html) … 5音の上昇下降
- [melody.html](melody.html) … 音声から音符を作り、鍵盤で再生する
- [pitch.html](pitch.html) … マイクでいまの音名とずれを出し、男性カラオケ音域の鍵盤で確認する

解析で作った曲の JSON は公開リポジトリへ置かない。ブラウザに残すか、手元へ保存する。

音程ページのマイクは、HTTPS または localhost で開いたときだけ使える。鍵盤は lowF（F2）から hihiC（C6）まで（lowソ〜hihiA を白鍵端で収める）。表記は設定で英字（hiA）／ドレミ／両方を切り替える。

## メロディの JSON

形は [melody.schema.json](melody.schema.json)。例は [melody.example.json](melody.example.json)。

```json
{
  "title": "練習用",
  "notes": [
    { "midi": 73, "startMs": 0, "durationMs": 420 }
  ]
}
```

- `midi` … C4 が 60。C#5 が 73
- `startMs` / `durationMs` … ミリ秒。再生時は速さの倍率だけ掛かる

melody.html の入力は次の2つである。

- 手元の音声ファイル（wav、mp3、m4a）。動画はブラウザが音声を読めるときだけ
- パソコンの Chrome / Edge で、再生中のタブの音を共有したもの

ファイルから JSON を先に作りたいときは、ボイトレ側の `tool`（Go）を使う。この公開ページには exe を置かない。

帯の音が混ざっている市販音源では、ギターやベースの高さに乗る。サビなど短い区間を録り、JSON を目と耳で直す。

## 帯入り音源を先に分ける（任意・手元）

ブラウザの YIN では足りないとき、手元でボーカルを分けてから同じ JSON を出す。YouTube から音源を落とす手順は書かない。手元の動画ファイルまたは音声ファイルを使う。

必要なもの: `ffmpeg`、Python、`demucs`、`basic-pitch`、`mido`。

```text
pip install demucs basic-pitch mido
ffmpeg -i 手元の動画.mp4 -vn -ac 1 -ar 44100 song.wav
python -m demucs --two-stems=vocals song.wav
```

Demucs の出力は `separated/htdemucs/song/vocals.wav` になる。ここから Basic Pitch（Spotify の音高推定）で MIDI を出す。

```text
basic-pitch out vocals.wav
```

MIDI をこのページの JSON にする例。

```python
import json
from mido import MidiFile

mid = MidiFile("out/vocals_basic_pitch.mid")
notes = []
t = 0.0
active = {}
for msg in mid:
    t += msg.time
    if msg.type == "note_on" and msg.velocity > 0:
        active[msg.note] = t * 1000
    elif msg.type in ("note_off", "note_on"):
        start = active.pop(msg.note, None)
        if start is None:
            continue
        dur = t * 1000 - start
        if dur > 80:
            notes.append(
                {
                    "midi": msg.note,
                    "startMs": round(start, 1),
                    "durationMs": round(dur, 1),
                }
            )
notes.sort(key=lambda n: n["startMs"])
with open("melody.json", "w", encoding="utf-8") as f:
    json.dump({"title": "練習用", "notes": notes}, f, ensure_ascii=False, indent=2)
```

できた `melody.json` を melody.html の「JSONを開く」で読む。ピアノページは JSON の出どころを問わない。
