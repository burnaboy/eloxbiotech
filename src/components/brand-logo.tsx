import logoLight from "@/assets/brand/elox-logo.png";
import logoDark from "@/assets/brand/elox-logo-dark.png";
import { cn } from "@/lib/utils";

/**
 * The Elox logo. Two copies are rendered and CSS shows the one that suits the colour mode:
 * black lettering on light backgrounds, white lettering on dark ones.
 * An admin can still override it with a logo URL in Settings > Brand.
 */
export function BrandLogo({ name, logoUrl, className }: { name: string; logoUrl?: string; className?: string }) {
  const size = cn("h-9 w-auto", className);
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={name} className={size} />;
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoLight.src} width={logoLight.width} height={logoLight.height} alt={name} className={cn(size, "logo-on-light")} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoDark.src} width={logoDark.width} height={logoDark.height} alt={name} className={cn(size, "logo-on-dark")} />
    </>
  );
}
