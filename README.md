# piano-pages

口を閉じた「ん」で、鳴っている高さに合わせる練習用ページ。

公開先は GitHub Pages である。

- [index.html](index.html) … 5音の上昇下降
- [melody.html](melody.html) … 音声から音符を作り、鍵盤で再生する
- [pitch.html](pitch.html) … マイクでいまの音名とずれを出し、男性カラオケ音域の鍵盤で確認する
- [editor.html](editor.html) … BPM と小節を入れて、再生用の JSON を作る

解析で作った曲の JSON は公開リポジトリへ置かない。ブラウザに残すか、手元へ保存する。

音程ページのマイクは、HTTPS または localhost で開いたときだけ使える。鍵盤は lowF（F2）から hihiC（C6）まで（lowソ〜hihiA を白鍵端で収める）。表記は設定で英字（hiA）／ドレミ／両方を切り替える。

半音往復は、選んだ高さを基音にして、基音と半音ずつ離れた音を往復する。「半音往復 高いド mid2B→mid2C」と「半音往復 高いド mid2C→mid2B」は、最初の戻る音が hiC（音名 C5）である。動く音は、戻る音のすぐ下から1オクターブ下までを半音ずつ進む。hiC のときは mid2B（音名 B4）と mid2C（音名 C4）のあいだである。半音、音階、オクターブの移動ボタンで、戻る音を上下できる。

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
- `bpm` / `numerator` / `denominator` … 入力ページが書き、再生ページは無視する。`bpm` は1分間の4分音符の数。4/4 なら分子 4、分母 4

## JSONの入力

[editor.html](editor.html) で、題名、BPM、拍子、小節、音の高さと長さを入れる。拍子の初期値は 4/4 である。1拍は4分音符である。拍の 1 は小節の先頭である。拍を 0.125 増やすと、32分音符ひとつ分あとにずれる。最短の音は32分音符である。

ピアノは画面の下に固定する。時間は縦である。一番下の行が先に鳴り、あとの音は上にある。列は鍵盤の鍵と揃う。行は32分音符ひとつ分である。マスを押して離すと、その鍵と時刻に、追加する長さの音を置く。空いているマスをドラッグすると、押した列で、押したマスから離したマスまで音を置く。ポインタがあるマスは色が変わる。音をドラッグすると高さと時刻が変わる。上下の端をドラッグすると長さが変わる。Shift、Ctrl、Mac の Command、または「複数選択」で複数の音を選び、本体をドラッグすると、選んだ音が同じ拍数、同じ半音数だけ動く。「全体を前へ」「全体を後ろへ」は、全部の音の開始と、フレーズの開始と、再生の印を、32分音符1つ分早くする、または遅くする。小節番号の列で横線を選び、「後へ32分足す」でその時刻より後を32分音符1つ分遅くし、線をまたぐ音を同じだけ長くする。「この32分を消す」で、その32分音符の区間を消す。上の欄では、BPM と、選択中の音の高さ（midi）を入れる。長さは2組ある。選択中の長さは、選んでいる音だけを変える。追加する長さは、次に置く音に使い、選んでいる音は変えない。どちらも数値の直接入力と一覧がある。一覧の 2 は2分音符、1 は4分音符、0.5 は8分音符である。3連符は、2分音符・4分音符・8分音符を3等分した1音で、0.667拍、0.333拍、0.167拍である。延長は、選択中の音へ、8分音符を3等分した1音（0.167拍）を足す。末尾へは、選択中の音の開始を、いちばん遅い音の終了へ合わせる。ドラッグでは、近い終了時刻へ合う。頭が他の音の終了に合っているあいだ、その終了側の音の色が変わる。「最初から」は曲の頭から再生する。「選択から」は、選択中の音の開始時刻から再生する。再生中は、いま鳴る行がピアノのすぐ上に来るように楽譜が縦に動く。

`startMs` と `durationMs` は、画面の BPM と小節の位置から計算する。できた JSON は melody.html の「JSONを開く」と、pitch.html の「曲」で読める。

入力内容はブラウザに残る。曲の JSON は公開リポジトリへ置かない。

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
