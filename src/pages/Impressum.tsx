import { SEOHead } from "@/components/SEOHead";
import { BRAND } from "@/lib/brand";

// Legal notice required by § 5 DDG for a commercial website reachable from Germany.
// Operator details match Terms and Privacy; company number and director were checked on
// the Companies House register on 22 September 2026.
const OPERATOR = {
  name: "Zelbel Limited",
  street: "69 Great Hampton Street",
  city: "Birmingham, B18 6EW",
  country: "United Kingdom",
  director: "Michael Zelbel",
  register: "Companies House, England and Wales",
  number: "05981833",
};

const h2 = "text-2xl font-semibold text-foreground mt-10 mb-4";

const Impressum = () => (
  <div className="container py-12 lg:py-16">
    <SEOHead title="Impressum — Menerio" description={`Legal notice (Impressum) for ${BRAND.name}: operator, address, company register and contact.`} />

    <div className="max-w-3xl">
      <h1 className="text-4xl font-bold text-foreground mb-2">Impressum</h1>
      <p className="text-muted-foreground mb-8">
        <strong>Last updated:</strong> September 22, 2026
      </p>

      <div className="prose prose-sm max-w-none dark:prose-invert space-y-6 text-muted-foreground">
        <p>Angaben gemäß § 5 DDG / Information according to § 5 of the German Digital Services Act</p>

        <section>
          <h2 className={h2}>Operator of this website</h2>
          <p>
            {OPERATOR.name}
            <br />
            {OPERATOR.street}
            <br />
            {OPERATOR.city}
            <br />
            {OPERATOR.country}
          </p>
        </section>

        <section>
          <h2 className={h2}>Represented by</h2>
          <p>{OPERATOR.director}, Director</p>
        </section>

        <section>
          <h2 className={h2}>Register</h2>
          <p>
            Registered in {OPERATOR.register}
            <br />
            Company number: {OPERATOR.number}
          </p>
        </section>

        <section>
          <h2 className={h2}>Contact</h2>
          <p>
            Email:{" "}
            <a href={`mailto:${BRAND.supportEmail}`} className="text-primary hover:underline">
              {BRAND.supportEmail}
            </a>
          </p>
        </section>

        <section>
          <h2 className={h2}>Responsible for the content (§ 18 (2) MStV)</h2>
          <p>
            {OPERATOR.director}
            <br />
            {OPERATOR.street}, {OPERATOR.city}, {OPERATOR.country}
          </p>
        </section>

        <section>
          <h2 className={h2}>Consumer dispute resolution</h2>
          <p>
            We are neither willing nor obliged to take part in dispute resolution proceedings before a
            consumer arbitration board (§ 36 VSBG). Wir sind nicht bereit und nicht verpflichtet, an
            Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
          </p>
        </section>

        <section>
          <h2 className={h2}>Liability for content</h2>
          <p>
            We write the content of this website with care, but we cannot guarantee that it is complete,
            correct and up to date at all times. As a service provider we are responsible for our own
            content under the general laws (§ 7 (1) DDG). We are not obliged to monitor information from
            others that we transmit or store, or to look for circumstances that point to illegal activity
            (§§ 8 to 10 DDG). Obligations to remove or block information under the general laws remain
            unaffected. Liability of that kind begins only when we learn of a specific infringement; when
            we do, we remove the content without delay.
          </p>
        </section>

        <section>
          <h2 className={h2}>Liability for links</h2>
          <p>
            This website links to websites of others, such as GitHub, whose content we do not control. The
            provider or operator of each linked page is responsible for it. We checked the linked pages for
            possible legal violations when we linked them and found none. Permanent monitoring of linked
            pages is not reasonable without concrete evidence of an infringement. When we learn of one, we
            remove the link without delay.
          </p>
        </section>

        <section>
          <h2 className={h2}>Copyright</h2>
          <p>
            The texts, images and design of this website are protected by copyright. Copying, editing,
            distributing or any use beyond the limits of copyright law needs the written consent of the
            operator. Where content on this site was not created by us, the rights of others are respected
            and marked as such. The source code of {BRAND.name} is published on GitHub under the licence
            stated there.
          </p>
        </section>
      </div>
    </div>
  </div>
);

export default Impressum;
