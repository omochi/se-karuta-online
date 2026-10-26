import { QRCodeSVG } from "qrcode.react";
import { formatJoinCode } from "../shared/join-code";
import "./display-join.css";

export function DisplayJoinGuide({
  url,
  homeUrl,
  code,
}: {
  url: string;
  homeUrl: string;
  code: string | null;
}) {
  return (
    <section className="display-join-guide" aria-label="スマホで参加しよう">
      <div className="display-join-heading">
        <h2>スマホで参加しよう</h2>
        {code && <p>どちらかの方法で参加画面を開いてください</p>}
      </div>
      <div className={`display-join-methods${code ? "" : " qr-only"}`}>
        <section
          className="display-join-method"
          aria-label="QRコードを読み取る"
        >
          <h3>QRコードを読み取る</h3>
          <div className="display-join-qr-body">
            <div className="display-join-qr">
              <QRCodeSVG
                value={url}
                size={216}
                level="M"
                marginSize={2}
                title="参加画面を開くQRコード"
              />
            </div>
            <p>
              スマホのカメラで読み取り、
              <br />
              参加画面を開く
            </p>
          </div>
        </section>
        {code && (
          <>
            <div className="display-join-divider">または</div>
            <section
              className="display-join-method"
              aria-label="URLとコードで入る"
            >
              <h3>URLとコードで入る</h3>
              <div className="display-join-manual">
                <div>
                  <p className="display-join-label">このURLを開く</p>
                  <a href={homeUrl} target="_blank" rel="noreferrer">
                    {homeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                </div>
                <div className="display-join-code-field">
                  <p className="display-join-label">参加コードを入力</p>
                  <div
                    className="display-join-code"
                    aria-label={`参加コード ${formatJoinCode(code)}`}
                  >
                    {formatJoinCode(code)}
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
      <p className="display-join-next">
        <span aria-hidden="true">↓</span> 参加画面で名前を登録したら、準備完了！
      </p>
    </section>
  );
}
