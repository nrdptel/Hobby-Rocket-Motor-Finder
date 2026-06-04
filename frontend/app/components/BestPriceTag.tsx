/** Small emerald "best" tag flagging the cheapest in-stock listing for a
 * variety. Shared by the desktop table and the mobile card so the styling and
 * tooltip copy can't drift. Pair with the emerald price styling at the call
 * site; whether to render it is decided by ``isBestInStockPrice``. */
export function BestPriceTag() {
  return (
    <span
      className="mr-1.5 rounded bg-emerald-950 px-1 py-0.5 text-[10px] font-medium text-emerald-400 align-middle"
      title="Lowest in-stock price for this variety across vendors"
    >
      best
    </span>
  );
}
