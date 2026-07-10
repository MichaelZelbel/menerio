// Build-time branding for white-label builds (docs/BRANDING.md).
// Both plugins are strict no-ops for the default Menerio brand, so the
// Lovable build pipeline is unaffected. With VITE_BRAND=<id>:
//  - brandIndexHtml strips Menerio meta from index.html and injects the
//    brand's title/description/OG tags + theme class (index.html itself
//    stays 100% Menerio and safe for Lovable to edit).
//  - brandStatics overlays brands/<id>/public/* onto dist/ after the bundle
//    is written and BEFORE vite-plugin-pwa generates the service worker in
//    closeBundle, so precache hashes reflect the overlaid files.
import fs from "node:fs";
import path from "node:path";
import type { HtmlTagDescriptor, Plugin } from "vite";
import type { BrandConfig } from "./src/brands/types";

export function brandIndexHtml(brand: BrandConfig): Plugin {
  return {
    name: "brand-index-html",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        if (brand.id === "menerio") return html;

        let out = html;
        // Strip the Menerio-branded head tags wholesale — drift-proof against
        // whatever meta Lovable adds later.
        out = out.replace(/<title>[\s\S]*?<\/title>\s*/i, "");
        out = out.replace(
          /<meta\s+(?:name|property)=["'](?:description|og:[^"']*|twitter:[^"']*|theme-color|google-site-verification)["'][^>]*>\s*/gi,
          "",
        );
        if (brand.themeClass) {
          out = out.replace(/<html(\s[^>]*)?>/i, (_m, attrs = "") => {
            if (/class=/.test(attrs)) {
              return `<html${attrs.replace(/class=["']([^"']*)["']/, `class="$1 ${brand.themeClass}"`)}>`;
            }
            return `<html${attrs} class="${brand.themeClass}">`;
          });
        }

        const tags: HtmlTagDescriptor[] = [
          { tag: "title", children: brand.htmlTitle, injectTo: "head" },
          { tag: "meta", attrs: { name: "description", content: brand.metaDescription }, injectTo: "head" },
          { tag: "meta", attrs: { property: "og:type", content: "website" }, injectTo: "head" },
          { tag: "meta", attrs: { property: "og:site_name", content: brand.name }, injectTo: "head" },
          { tag: "meta", attrs: { property: "og:title", content: brand.htmlTitle }, injectTo: "head" },
          { tag: "meta", attrs: { property: "og:description", content: brand.metaDescription }, injectTo: "head" },
          { tag: "meta", attrs: { property: "og:image", content: brand.ogImage }, injectTo: "head" },
          { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" }, injectTo: "head" },
          { tag: "meta", attrs: { name: "twitter:title", content: brand.htmlTitle }, injectTo: "head" },
          { tag: "meta", attrs: { name: "twitter:description", content: brand.metaDescription }, injectTo: "head" },
          { tag: "meta", attrs: { name: "twitter:image", content: brand.ogImage }, injectTo: "head" },
          { tag: "meta", attrs: { name: "theme-color", content: brand.htmlThemeColor }, injectTo: "head" },
        ];
        return { html: out, tags };
      },
    },
  };
}

export function brandStatics(brand: BrandConfig, rootDir: string): Plugin {
  return {
    name: "brand-statics",
    apply: "build",
    writeBundle() {
      if (brand.id === "menerio") return;
      const overlayDir = path.resolve(rootDir, "brands", brand.id, "public");
      const distDir = path.resolve(rootDir, "dist");
      if (!fs.existsSync(overlayDir) || !fs.existsSync(distDir)) return;
      for (const file of fs.readdirSync(overlayDir)) {
        fs.copyFileSync(path.join(overlayDir, file), path.join(distDir, file));
      }
      this.warn(`brand-statics: overlaid ${fs.readdirSync(overlayDir).length} files from brands/${brand.id}/public onto dist/`);
    },
  };
}
