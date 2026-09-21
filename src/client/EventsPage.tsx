import { useState } from "react";
import { Link, useLoaderData, useRevalidator } from "react-router";
import { api } from "./api";
import { Header, PasswordForm } from "./components";
import { EventList } from "./EventList";
import type { EventsData } from "./route-loaders";

export default function EventsPage() {
  const { listing } = useLoaderData<EventsData>();
  const revalidator = useRevalidator();
  const [error, setError] = useState("");
  return (
    <>
      <Header>
        <Link className="events-home-link" to="/">
          トップへ戻る →
        </Link>
      </Header>
      <main className="events-page">
        <section className="home-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR TOURNAMENTS</p>
              <h1>大会一覧</h1>
            </div>
          </div>
          {!listing ? (
            <PasswordForm
              label="管理用パスワード"
              error={error}
              onSubmit={async (password) => {
                try {
                  await api("/api/admin/login", { password });
                  setError("");
                  await revalidator.revalidate();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          ) : listing.total === 0 ? (
            <p className="empty-small muted">
              まだ大会はありません。トップページから大会を作成できます。
            </p>
          ) : (
            <>
              <p className="muted">
                全{listing.total}件中{" "}
                {(listing.page - 1) * listing.pageSize + 1}〜
                {(listing.page - 1) * listing.pageSize + listing.events.length}
                件
              </p>
              <EventList events={listing.events} />
              {listing.pageCount > 1 && (
                <nav
                  className="event-pagination"
                  aria-label="大会一覧のページ切り替え"
                >
                  {listing.page > 1 ? (
                    <Link to={`?page=${listing.page - 1}`}>← 前のページ</Link>
                  ) : (
                    <span />
                  )}
                  <span>
                    {listing.page} / {listing.pageCount} ページ
                  </span>
                  {listing.page < listing.pageCount ? (
                    <Link to={`?page=${listing.page + 1}`}>次のページ →</Link>
                  ) : (
                    <span />
                  )}
                </nav>
              )}
            </>
          )}
        </section>
      </main>
    </>
  );
}
