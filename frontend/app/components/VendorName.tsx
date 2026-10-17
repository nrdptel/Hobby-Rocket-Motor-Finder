/** A vendor's name, with a line-break opportunity before a trailing domain
 * suffix ("BuyRocketMotors<wbr>.com"). The mobile listing cards let the name
 * wrap instead of truncating it with an ellipsis; at the narrowest phones a
 * one-word domain name is wider than its column, and without this hint the
 * browser breaks it mid-word ("BuyRocketMotors.co" / "m"). `<wbr>` adds no
 * text, so copy/paste and the accessible name are unchanged. Shared by the
 * catalog card and the motor page's mobile cards. */
export function VendorName({ name }: { name: string }) {
  const m = /^(.+?)(\.[a-z]{2,})$/i.exec(name);
  if (!m) return <>{name}</>;
  return (
    <>
      {m[1]}
      <wbr />
      {m[2]}
    </>
  );
}
