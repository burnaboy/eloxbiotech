/* eslint-disable @next/next/no-img-element */

/*
 * The Elox logo. The "ELOX" lettering is black, so a second copy with light lettering is shown in dark mode
 * (the swap is in globals.css and follows the same Light / Dark / System choice as the colours).
 * A logo URL set in Admin → Settings replaces it.
 */
export function BrandLogo({ name, logoUrl, className = "h-9" }: { name: string; logoUrl?: string; className?: string }) {
  if (logoUrl) return <img src={logoUrl} alt={name} className={`${className} w-auto`} />;
  return (
    <>
      <img src="/brand/elox-logo.png" alt={name} width={199} height={87} className={`logo-light ${className} w-auto`} />
      <img src="/brand/elox-logo-dark.png" alt={name} width={199} height={87} className={`logo-dark ${className} w-auto`} />
    </>
  );
}
