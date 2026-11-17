import Image from "next/image";
import { getBrand } from "@/lib/settings";
import eloxLab from "@/assets/about/elox-lab.webp";
import labResearch from "@/assets/about/lab-research.webp";
import { ABOUT_SUBTITLE, ABOUT_TITLE, AboutParagraphs, FreeFromList } from "@/components/about-elox";

export const metadata = { title: "About us" };

export default async function About() {
  const b = await getBrand();
  return (
    <div className="space-y-12">
      <header className="relative overflow-hidden rounded-xl border">
        <Image src={labResearch} alt="A scientist examining a sample under a microscope in a laboratory" priority placeholder="blur" sizes="(min-width: 1400px) 1400px, 100vw" className="h-72 w-full object-cover md:h-80" />
        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/75 via-black/30 to-transparent p-6 text-white md:p-10">
          <p className="text-sm font-medium uppercase tracking-widest text-white/80">About us</p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{ABOUT_TITLE}</h1>
          <p className="mt-1 text-lg text-white/90">{ABOUT_SUBTITLE}</p>
        </div>
      </header>

      <section className="grid gap-10 md:grid-cols-[1.6fr_1fr] md:items-start" aria-label="Who we are">
        <div className="space-y-8">
          <div className="space-y-4 text-[15px] leading-relaxed text-foreground/90">
            <AboutParagraphs />
          </div>
          <FreeFromList />
          <article className="prose-page">
            {b.about && b.about.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
            <h2>What we stand for</h2>
            <ul>
              <li>Genuine products at clear prices, with tracked delivery.</li>
              <li>A transparent compensation plan that pays only on real product sales, never for signing people up.</li>
              <li>No joining fee and no requirement to buy stock or starter packs.</li>
              <li>Fair returns and refunds, as set out in our <a href="/legal/refunds">refund policy</a>.</li>
            </ul>
            {(b.registrationNumber || b.address) && (
              <>
                <h2>Company details</h2>
                {b.registrationNumber && <p>Registration number: {b.registrationNumber}</p>}
                {b.address && <p>Address: {b.address}</p>}
              </>
            )}
          </article>
        </div>
        <Image src={eloxLab} alt="Elox laboratory scientist using a microscope beside sample flasks" placeholder="blur" sizes="(min-width: 768px) 35vw, 100vw" className="mx-auto h-auto w-full max-w-md rounded-xl border" />
      </section>
    </div>
  );
}
