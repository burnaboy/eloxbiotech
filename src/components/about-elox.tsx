import { CheckCircle2 } from "lucide-react";

/** Elox BioTech company write-up, shared by the home page and the About page. */
export const ABOUT_TITLE = "Welcome To Elox BioTech Limited";
export const ABOUT_SUBTITLE = "A Water Based Disinfection Technology Solutions";

export const FREE_FROM = ["Solvent free", "Fragrance free", "Dye free", "Aldehyde free", "Alcohol free", "Phenol free"];

export function AboutParagraphs() {
  return (
    <>
      <p>
        Elox Bio-technologies Ltd., a venture based in Abuja Nigeria, is strategically positioned with its research, development, prototyping, and
        manufacturing facility linked to its parent company, Elox GmbH in Velden, Austria.
      </p>
      <p>
        Specializing in cutting-edge disinfection and deacidification technologies, the company’s flagship products, HB Solution and iCell are recognized
        for their efficacy and have contributed to Elox GmbH’s substantial revenue in Europe.
      </p>
      <p>
        Our product, HB Solution is a ready-to-use solution for general disinfection (such as water, surface and in green cleaning) including restricted
        areas with limited access. The product is safe for humans and animals and are biodegradable.
      </p>
    </>
  );
}

export function FreeFromList() {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="HB Solution is">
      {FREE_FROM.map((t) => (
        <li key={t} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium uppercase tracking-wide">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          {t}
        </li>
      ))}
    </ul>
  );
}
