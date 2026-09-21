# 作問マニュアル

Swift Evolution Karuta Online の問題を作成・レビューするときの共通ルール。少数の試作に対するレビューを反映しながら、生成ルールとコツをこの文書に蓄積する。

## 題材と難易度

- Swift の設計や実用上の意味を知ると面白い、重要な Proposal を題材にする。
- 基本的な問題に加えて、関連する Proposal の役割の違いや、コードが成立する理由を考える歯応えのある問題も用意する。
- マニアックな細部を知っているだけで決まる難しさを狙わない。
- コードや問題文から、正解を選ぶ決め手が読み取れるようにする。

## 解説のリンク先（確定ルール）

- `explanationMarkdown` に載せる Proposal の解説リンクは、**koher さんの [Swift Digest](https://swiftdigest.koherent.org/) の該当記事を使う**。日本語で要約を読めることを優先する。
- GitHub の Proposal 原文リンクを参加者向け解説の標準にしない。draft・本番用の問題とも同じルールを適用する。
- リンクの表示名は `Swift Digest：SE-XXXXの日本語要約` とし、対象の Proposal が分かるようにする。
- URL は `https://swiftdigest.koherent.org/proposals/se-XXXX.html`（番号は4桁）。リンク先を開き、番号と記事タイトルが合っていることを確認する。
- 問題・解説の厳密な根拠や原文との整合性は、出題者が後のレビューで精査する。生成時に原文の根拠リンクを解説へ付けることを必須にしない。
- 該当する Swift Digest の記事が見つからない場合は、リンクを推測で掲載せず、レビュー時の確認事項として伝える。

例：

```markdown
[Swift Digest：SE-0143の日本語要約](https://swiftdigest.koherent.org/proposals/se-0143.html)
```

## 試作とレビュー

1. 大量生成の前に、まず3問程度を試作する。現在の試作は [`draft-01.json`](../data/questions/draft-01.json)。
2. 出題者が難易度・面白さ・説明の分かりやすさをレビューし、その意見をこの文書へ反映する。
3. 問題ビューワの Display プレビューで、実際の表示領域にコードと選択肢が収まるか確認する。文字が小さすぎる場合は問題文・コードの分量を調整する。
4. `npm run questions:check -- data/questions/draft-01.json` などで対象ファイルの形式を検証する。

試作はレビュー前の状態として扱い、本番用に確定する前に出題者が内容を精査する。
