"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import waterRipple from "@/assets/slides/water-ripple.webp";
import waterSplash from "@/assets/slides/water-splash.webp";
import runnerHydration from "@/assets/slides/runner-hydration.webp";
import underwater from "@/assets/slides/underwater.webp";
import hygieneBlaster from "@/assets/slides/hygiene-blaster.webp";
import icellAlkaline from "@/assets/slides/icell-alkaline.webp";

type Slide = {
  /** "photo" fills the slide with the picture; "product" shows a bottle cut-out on a brand-coloured panel. */
  kind: "photo" | "product";
  image: StaticImageData;
  alt: string;
  eyebrow: string;
  title: string;
  text: string;
  cta: { label: string; href: string };
};

// Product wording sticks to what is printed on each label, so the slideshow makes no extra health claims.
const SLIDES: Slide[] = [
  {
    kind: "product",
    image: icellAlkaline,
    alt: "A 500 ml bottle of Elox iCell alkaline water",
    eyebrow: "Elox iCell",
    title: "Alkaline water, bottled for every day",
    text: "pH balanced, rich in minerals and refreshing. 500 ml bottle.",
    cta: { label: "Shop iCell", href: "/products" },
  },
  {
    kind: "photo",
    image: runnerHydration,
    alt: "A young man drinking from a water bottle on a running track",
    eyebrow: "Stay refreshed",
    title: "Hydration that keeps up with you",
    text: "Take Elox water to training, to work and everywhere in between.",
    cta: { label: "Shop now", href: "/products" },
  },
  {
    kind: "product",
    image: hygieneBlaster,
    alt: "A 1 litre bottle of Elox Hygiene Blaster Solution water disinfectant",
    eyebrow: "Elox Hygiene Blaster",
    title: "HB Solution water disinfectant",
    text: "Hypochlorous acid (HOCl) for drinking water. Free from solvents, fragrance, dye, aldehyde, alcohol and phenol. 1 litre bottle.",
    cta: { label: "Shop HB Solution", href: "/products" },
  },
  {
    kind: "photo",
    image: waterSplash,
    alt: "A drop of water splashing into a clear blue pool",
    eyebrow: "Elox BioTech",
    title: "Made with water at its heart",
    text: "Water products from Elox BIO Technologies, made in Abuja, Nigeria.",
    cta: { label: "About us", href: "/about" },
  },
  {
    kind: "photo",
    image: underwater,
    alt: "Bubbles rising under the surface of clear green water",
    eyebrow: "Clean water",
    title: "Clean water for your home",
    text: "Treat and enjoy the water your family drinks every day.",
    cta: { label: "Browse products", href: "/products" },
  },
  {
    kind: "photo",
    image: waterRipple,
    alt: "A clear stream of water pouring against a pale blue background",
    eyebrow: "Share and earn",
    title: "Love the products? Share them",
    text: "Join the affiliate programme free and earn on genuine product sales.",
    cta: { label: "Become an affiliate", href: "/affiliate-programme" },
  },
];

const INTERVAL_MS = 6000;

export function HeroSlideshow() {
  const [index, setIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const touchX = useRef<number | null>(null);
  const count = SLIDES.length;

  const go = useCallback((i: number) => setIndex(((i % count) + count) % count), [count]);

  // People who ask their device for less motion get a still slideshow they move themselves.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const playing = !userPaused && !hovered && !focused && !reducedMotion;

  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(() => {
      if (document.visibilityState === "visible") go(index + 1);
    }, INTERVAL_MS);
    return () => window.clearTimeout(t);
  }, [playing, index, go]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Elox products"
      className="relative overflow-hidden border-b bg-muted"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(index - 1);
        if (e.key === "ArrowRight") go(index + 1);
      }}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        const end = e.changedTouches[0]?.clientX;
        touchX.current = null;
        if (start == null || end == null || Math.abs(end - start) < 40) return;
        go(end < start ? index + 1 : index - 1);
      }}
    >
      <div className="relative h-[420px] sm:h-[440px] lg:h-[500px]" aria-live={playing ? "off" : "polite"}>
        {SLIDES.map((s, i) => {
          const active = i === index;
          return (
            <div
              key={s.title}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}: ${s.eyebrow}`}
              aria-hidden={!active}
              inert={!active}
              className={cn(
                "absolute inset-0 transition-[opacity,visibility] duration-700 ease-in-out motion-reduce:transition-none",
                active ? "visible z-10 opacity-100" : "invisible z-0 opacity-0",
              )}
            >
              {s.kind === "photo" ? <PhotoSlide slide={s} priority={i === 0} /> : <ProductSlide slide={s} priority={i === 0} />}
            </div>
          );
        })}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20">
        <div className="container flex items-center justify-between gap-3">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-background/75 px-2 py-1.5 shadow-sm backdrop-blur">
            {SLIDES.map((s, i) => (
              <button
                key={s.title}
                type="button"
                onClick={() => go(i)}
                aria-label={`Show slide ${i + 1}: ${s.eyebrow}`}
                aria-current={i === index ? "true" : undefined}
                className="flex h-6 w-6 items-center justify-center rounded-full"
              >
                <span className={cn("block h-2 rounded-full transition-all", i === index ? "w-5 bg-primary" : "w-2 bg-foreground/35")} />
              </button>
            ))}
          </div>
          <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-background/75 p-1 shadow-sm backdrop-blur">
            <ControlButton label="Previous slide" onClick={() => go(index - 1)}><ChevronLeft /></ControlButton>
            <ControlButton label={userPaused ? "Play slideshow" : "Pause slideshow"} onClick={() => setUserPaused((p) => !p)}>
              {userPaused ? <Play /> : <Pause />}
            </ControlButton>
            <ControlButton label="Next slide" onClick={() => go(index + 1)}><ChevronRight /></ControlButton>
          </div>
        </div>
      </div>
    </section>
  );
}

function ControlButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted [&_svg]:h-4 [&_svg]:w-4"
    >
      {children}
    </button>
  );
}

function SlideText({ slide, onPhoto }: { slide: Slide; onPhoto: boolean }) {
  return (
    <div className="max-w-xl space-y-3">
      <p className={cn("text-xs font-semibold uppercase tracking-widest sm:text-sm", onPhoto ? "text-white/85" : "text-accent")}>{slide.eyebrow}</p>
      <p className={cn("text-2xl font-semibold tracking-tight sm:text-4xl lg:text-5xl", onPhoto && "text-white")}>{slide.title}</p>
      <p className={cn("text-sm sm:text-lg", onPhoto ? "text-white/85" : "text-muted-foreground")}>{slide.text}</p>
      <Link
        href={slide.cta.href}
        className="inline-flex h-11 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        {slide.cta.label}
      </Link>
    </div>
  );
}

function PhotoSlide({ slide, priority }: { slide: Slide; priority: boolean }) {
  return (
    <>
      <Image src={slide.image} alt={slide.alt} fill priority={priority} placeholder="blur" sizes="100vw" className="object-cover" />
      {/* Darkens the side under the text so it stays readable on any photo and in either colour mode. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/40 to-black/10 sm:bg-gradient-to-r sm:from-black/70 sm:via-black/35 sm:to-transparent" aria-hidden />
      <div className="container relative flex h-full items-end pb-20 sm:items-center sm:pb-0">
        <SlideText slide={slide} onPhoto />
      </div>
    </>
  );
}

function ProductSlide({ slide, priority }: { slide: Slide; priority: boolean }) {
  return (
    <div className="h-full bg-gradient-to-br from-primary/25 via-background to-accent/15">
      <div className="container grid h-full grid-cols-[1fr_auto] items-center gap-4 pb-14 sm:grid-cols-[1.3fr_1fr] sm:pb-0">
        <SlideText slide={slide} onPhoto={false} />
        <div className="relative h-[62%] w-[34vw] max-w-[320px] self-center sm:h-[82%] sm:w-full">
          <div className="absolute inset-x-[10%] bottom-[4%] h-[12%] rounded-[50%] bg-foreground/15 blur-xl" aria-hidden />
          <Image
            src={slide.image}
            alt={slide.alt}
            fill
            priority={priority}
            sizes="(min-width: 1024px) 320px, (min-width: 640px) 35vw, 34vw"
            className="object-contain drop-shadow-xl"
          />
        </div>
      </div>
    </div>
  );
}
