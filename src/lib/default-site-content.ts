// Built-in site content, derived from the translation dictionaries.
//
// Used in two places:
//  - `getSiteContent` falls back to it when the database has no (or only partial)
//    content, so the public pages never crash on an empty database.
//  - `prisma/seed.ts` stores it when there is no exported content to restore.
//
// Only type imports are used here, so the seed script can run this file without
// resolving the `@/` path alias.
import type { Dictionary } from "@/contexts/dictionary-context";
import type { SiteContent } from "@/lib/schemas/content";

type SiteContentDictionary = Pick<
  Dictionary,
  "home" | "footer" | "faq_page" | "contact_page"
>;

export function buildDefaultSiteContent(
  dict: SiteContentDictionary,
): SiteContent {
  const { home, footer, faq_page: faq, contact_page: contact } = dict;

  return {
    hero: {
      title: home.title,
      subtitle: home.subtitle,
      button1: home.getStarted,
      button2: home.viewPricing,
    },

    features: {
      title: home.featuresTitle,
      subtitle: home.featuresSubtitle,
      features: [
        home.feature1Title,
        home.feature2Title,
        home.feature3Title,
        home.feature4Title,
      ].map((title) => ({ title })),
    },

    howItWorks: {
      title: home.howItWorksTitle,
      steps: home.steps.map(({ title, text }) => ({ title, text })),
    },

    testimonials: {
      pill: home.testimonialsPill,
      title: home.testimonialsTitle,
      subtitle: home.testimonialsSubtitle,
      items: [
        {
          name: home.testimonial1Name,
          title: home.testimonial1Title,
          text: home.testimonial1Text,
          avatarInitial: home.testimonial1Avatar,
        },
        {
          name: home.testimonial2Name,
          title: home.testimonial2Title,
          text: home.testimonial2Text,
          avatarInitial: home.testimonial2Avatar,
        },
        {
          name: home.testimonial3Name,
          title: home.testimonial3Title,
          text: home.testimonial3Text,
          avatarInitial: home.testimonial3Avatar,
        },
      ],
    },

    contact: {
      title: contact.title,
      subtitle: contact.subtitle,
      emailCardTitle: contact.email_title,
      emailCardDesc: contact.email_desc,
      phoneCardTitle: contact.phone_title,
      phoneCardDesc: contact.phone_desc,
      addressCardTitle: contact.address_title,
      chatCardTitle: contact.chat_title,
      chatCardDesc: contact.chat_desc,
      chatButtonText: contact.chat_button,
    },

    faq: {
      title: faq.title,
      subtitle: faq.subtitle,
      items: [
        { question: faq.q1, answer: faq.a1 },
        { question: faq.q2, answer: faq.a2 },
        { question: faq.q3, answer: faq.a3 },
        { question: faq.q4, answer: faq.a4 },
        { question: faq.q5, answer: faq.a5 },
        { question: faq.q6, answer: faq.a6 },
      ],
    },

    footer: {
      aboutText: footer.aboutText,
      contactEmail: footer.contactEmail,
      contactPhone: footer.contactPhone,
      contactAddress: footer.contactAddress,
      social: {
        facebook: footer.social.facebook,
        twitter: footer.social.twitter,
        instagram: footer.social.instagram,
      },
      copyright: footer.copyright,
    },
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Fills in whatever `content` is missing from `defaults`.
 *
 * - a missing (or null) key takes the default
 * - nested objects are merged recursively
 * - a value that is present always wins, including empty strings and arrays,
 *   so deliberate edits made in the admin panel are never overridden
 */
export function withDefaults<T extends object>(
  content: unknown,
  defaults: T,
): T {
  if (!isPlainObject(content)) return defaults;

  const result: Record<string, unknown> = { ...content };

  for (const [key, fallback] of Object.entries(defaults)) {
    const value = content[key];

    if (value === undefined || value === null) {
      result[key] = fallback;
    } else if (isPlainObject(fallback) && isPlainObject(value)) {
      result[key] = withDefaults(value, fallback);
    }
  }

  return result as T;
}
