import { useEffect, useRef, useState } from "react";
import { nativeAppearanceTheme } from "./appearance";
import { readSetting, writeSetting } from "./preferences";
import { scanLanguagesFrom, type ScanLanguage } from "./scanLanguage";

export function useReaderPreferences({ active, gallery, initialGallery, flash }: {
  active: boolean; gallery: boolean; initialGallery: boolean; flash(message: string): void;
}) {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || "light");
  const [night, setNight] = useState(() => !initialGallery && readSetting("folio:night") === "1");
  const [sidebar, setSidebar] = useState(() => !initialGallery && readSetting("folio:sidebar") !== "0" && window.innerWidth > 760);
  const [spread, setSpread] = useState(() => !initialGallery && readSetting("folio:spread") === "1");
  const [wheelPaging, setWheelPaging] = useState(() => readSetting("folio:wheel-paging") === "1");
  const [scanLanguages, setScanLanguages] = useState(() => scanLanguagesFrom(readSetting("folio:scan-language")));
  const wheelPagingRef = useRef(wheelPaging);
  wheelPagingRef.current = wheelPaging;
  const spreadRef = useRef(spread);
  spreadRef.current = spread;

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === "folio:theme" && (event.newValue === "light" || event.newValue === "dark")) {
        document.documentElement.dataset.theme = event.newValue; setTheme(event.newValue);
      }
      if (event.key === "folio:night") setNight(event.newValue === "1");
      if (event.key === "folio:wheel-paging") setWheelPaging(event.newValue === "1");
      if (event.key === "folio:scan-language" || event.key === null) setScanLanguages(scanLanguagesFrom(event.newValue));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => { if (active) window.folioDesktop?.setTheme(nativeAppearanceTheme(theme)); }, [active, theme]);
  useEffect(() => { if (!gallery) writeSetting("folio:sidebar", sidebar ? "1" : "0"); }, [sidebar, gallery]);

  const setThemeTo = (next: "light" | "dark") => {
    document.documentElement.dataset.theme = next;
    writeSetting("folio:theme", next);
    setTheme(next);
  };
  const setNightTo = (next: boolean) => {
    if (!writeSetting("folio:night", next ? "1" : "0")) flash("PDF dark mode changed, but couldn't save the preference.");
    setNight(next);
  };
  const setSpreadTo = (next: boolean) => {
    setSpread(next);
    writeSetting("folio:spread", next ? "1" : "0");
  };
  const setScanLanguagesTo = (next: ScanLanguage[]) => {
    setScanLanguages(next);
    if (!writeSetting("folio:scan-language", next.join("+"))) flash("Scan languages changed, but couldn't save the preference.");
  };
  const setWheelPagingTo = (next: boolean) => {
    setWheelPaging(next);
    if (!writeSetting("folio:wheel-paging", next ? "1" : "0")) flash("Page scrolling changed, but couldn't save the preference.");
  };

  return { theme, setThemeTo, night, setNightTo, sidebar, setSidebar, spread, setSpread, setSpreadTo, spreadRef,
    wheelPaging, wheelPagingRef, setWheelPagingTo, scanLanguages, setScanLanguagesTo };
}
