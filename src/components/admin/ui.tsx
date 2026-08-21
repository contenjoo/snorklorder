// 관리자 화면 공용 UI 킷 — 페이지 헤더·카드·상태칩·빈 상태를 한 모양으로.
import { STATUS_LABEL, STATUS_CHIP, STATUS_DOT } from "@/lib/status";

/** 페이지 최상단 헤더: 제목 + 인라인 통계 + 우측 액션. 전 페이지 동일 형태. */
export function PageHeader({ title, children, actions }: {
  title: string;
  children?: React.ReactNode; // 인라인 통계 (span 들)
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-center gap-4 flex-wrap">
        <h1 className="text-lg font-bold text-slate-900 whitespace-nowrap">{title}</h1>
        {children && (
          <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">{children}</div>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 sm:ml-auto">{actions}</div>}
    </div>
  );
}

/** 헤더 통계 구분자 */
export function StatDivider() {
  return <span className="text-slate-200">|</span>;
}

/** 상태 칩 — 색은 STATUS_CHIP 공용 팔레트 고정 */
export function StatusChip({ status, label, className = "" }: { status: string; label?: string; className?: string }) {
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap ${STATUS_CHIP[status] || "bg-slate-100 text-slate-500"} ${className}`}>
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** 상태 점 */
export function StatusDot({ status, size = "sm" }: { status: string; size?: "sm" | "md" }) {
  const dim = size === "md" ? "w-2 h-2" : "w-1.5 h-1.5";
  return <span className={`${dim} rounded-full shrink-0 ${STATUS_DOT[status] || "bg-slate-300"}`} />;
}

/** 흰 카드 컨테이너 (rounded-2xl 통일) */
export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white rounded-2xl border overflow-hidden ${className}`}>{children}</div>;
}

/** 카드 상단 타이틀 행 */
export function CardTitle({ title, badge, actions }: { title: string; badge?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-4 md:px-5 py-3.5 border-b">
      <h2 className="font-bold text-slate-900 text-[15px]">{title}</h2>
      {badge}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** 빈 상태 — 왜 비었는지 + 다음 행동 힌트 */
export function EmptyState({ icon = "🗂️", title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="text-center py-14">
      <p className="text-2xl mb-2">{icon}</p>
      <p className="text-slate-500 text-sm font-medium">{title}</p>
      {hint && <p className="text-slate-400 text-xs mt-1">{hint}</p>}
    </div>
  );
}

/** 중앙 로딩 스피너 */
export function Spinner() {
  return (
    <div className="flex justify-center py-20">
      <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin" />
    </div>
  );
}
