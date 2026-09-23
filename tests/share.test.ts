import { describe, it, expect } from "vitest";
import { composeShared, safeUrl } from "@/lib/brain/share";

describe("what another app shares", () => {
  it("reads Chrome's share: the page title, and the address sent as text", () => {
    const s = composeShared({ title: "Le guide du parrainage B2B", text: "https://exemple.fr/parrainage" });
    expect(s).toMatchObject({ title: "Le guide du parrainage B2B", detail: null, url: "https://exemple.fr/parrainage", long: false });
  });

  it("keeps the address once, whichever fields repeat it", () => {
    const s = composeShared({
      title: "Article",
      text: "À lire : https://exemple.fr/a/ https://exemple.fr/a/",
      url: "https://exemple.fr/a/",
    });
    expect(s?.url).toBe("https://exemple.fr/a/");
    expect(s?.detail).toBe("À lire :");
  });

  it("takes a notes app's text: first line as the title, the rest as detail", () => {
    const s = composeShared({ text: "Idée podcast\nÉpisode 1 : le bouche-à-oreille\nÉpisode 2 : le parrainage" });
    expect(s?.title).toBe("Idée podcast");
    expect(s?.detail).toBe("Épisode 1 : le bouche-à-oreille\nÉpisode 2 : le parrainage");
    expect(s?.long).toBe(true);
    expect(s?.full).toContain("Épisode 2");
  });

  it("refuses addresses that are not http(s) — the fields come from a URL anyone can build", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(safeUrl("ftp://exemple.fr")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    const s = composeShared({ title: "Piège", url: "javascript:alert(1)" });
    expect(s).toMatchObject({ title: "Piège", url: null });
  });

  it("loses nothing: a title too long is cut, and kept whole in the detail", () => {
    const long = `Une réflexion ${"très ".repeat(60)}longue`;
    const s = composeShared({ text: long });
    expect(s!.title.length).toBeLessThanOrEqual(200);
    expect(s!.title.endsWith("…")).toBe(true);
    expect(s!.detail).toBe(long);
  });

  it("returns nothing when nothing was shared", () => {
    expect(composeShared({})).toBeNull();
    expect(composeShared({ title: "  ", text: "\n\n", url: "javascript:void(0)" })).toBeNull();
    expect(composeShared({ title: 42, text: ["x"] })).toBeNull();
  });

  it("uses the address as the title when it is all there is", () => {
    expect(composeShared({ url: "https://exemple.fr/" })).toMatchObject({ title: "https://exemple.fr/", url: null });
  });
});
