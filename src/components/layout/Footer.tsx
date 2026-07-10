import { Link } from "react-router-dom";
import { Github, Twitter, Linkedin, Mail } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { brandLogo } from "@/lib/brand-assets";

const productLinks = [
  ...(BRAND.showDocs ? [{ label: "Docs", to: "/docs" }] : []),
  { label: "Source Code", to: "https://github.com/MichaelZelbel/menerio", external: true },
];


const legalLinks = [
  { label: "Privacy Policy", to: "/privacy" },
  { label: "Terms of Service", to: "/terms" },
  { label: "Cookie Policy", to: "/cookies" },
];

const socialLinks = [
  { icon: Twitter, href: "https://x.com/MichaelZelbel", label: "X" },
  { icon: Github, href: "https://github.com/MichaelZelbel/menerio", label: "GitHub" },
  { icon: Linkedin, href: "https://www.linkedin.com/in/michaelzelbel/", label: "LinkedIn" },
  { icon: Mail, href: `mailto:${BRAND.supportEmail}`, label: "Email" },
];

export function Footer() {
  return (
    <footer className="border-t border-[hsl(var(--border)/.08)] bg-[hsl(var(--background-soft))] text-[hsl(var(--landing-text))] dark:border-[hsl(var(--landing-plain-white)/.06)] dark:bg-[hsl(var(--landing-page))]">
      <div className="mx-auto max-w-[1180px] px-6 py-12 md:px-9">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          {/* Brand + Newsletter */}
          <div>
            <Link to="/" className="mb-3 flex items-center gap-3">
              <img src={brandLogo} alt={BRAND.name} className="h-8 w-8 object-contain" />
              <span className="font-display text-xl font-extrabold text-[hsl(var(--landing-text))]">{BRAND.name}</span>
            </Link>
            <p className="max-w-sm text-sm leading-relaxed text-[hsl(var(--landing-muted))]">
              {BRAND.tagline}
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="mb-3 font-display text-sm font-bold text-[hsl(var(--landing-text))]">Product</h4>
            <ul className="space-y-3">
              {productLinks.map((link) => (
                <li key={link.to}>
                  {"external" in link && link.external ? (
                    <a
                      href={link.to}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-[hsl(var(--landing-muted))] transition-colors hover:text-[hsl(var(--landing-sky-highlight))]"
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      to={link.to}
                      className="text-sm text-[hsl(var(--landing-muted))] transition-colors hover:text-[hsl(var(--landing-sky-highlight))]"
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>


          {/* Legal */}
          <div>
            <h4 className="mb-3 font-display text-sm font-bold text-[hsl(var(--landing-text))]">Legal</h4>
            <ul className="space-y-3">
              {legalLinks.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="text-sm text-[hsl(var(--landing-muted))] transition-colors hover:text-[hsl(var(--landing-sky-highlight))]"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-[hsl(var(--border)/.08)] dark:border-[hsl(var(--landing-plain-white)/.05)]">
        <div className="mx-auto flex max-w-[1180px] flex-col items-center justify-between gap-4 px-6 py-5 text-xs text-[hsl(var(--landing-faint))] sm:flex-row md:px-9">
          <p>
            © {new Date().getFullYear()} {BRAND.name}. All rights reserved.
          </p>
          <div className="flex items-center gap-3">
            {socialLinks.map((social) => (
              <a
                key={social.label}
                href={social.href}
                target={social.href.startsWith("mailto:") ? undefined : "_blank"}
                rel={social.href.startsWith("mailto:") ? undefined : "noopener noreferrer"}
                aria-label={social.label}
                className="flex h-7 w-7 items-center justify-center rounded-md bg-[hsl(var(--brand)/.08)] text-[hsl(var(--landing-muted))] transition-colors hover:bg-[hsl(var(--brand)/.12)] hover:text-[hsl(var(--brand))] dark:bg-[hsl(var(--landing-plain-white)/.04)] dark:hover:bg-[hsl(var(--landing-sky-primary)/.12)] dark:hover:text-[hsl(var(--landing-sky-highlight))]"
              >
                <social.icon className="h-3.5 w-3.5" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
