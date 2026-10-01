# DJI Enterprise — Wildfire company-profile portfolio

Code Challenge 2 by Wili K. An independent educational adaptation of DJI’s wildfire reference, not an official DJI website.

## Stack and routes

React 19, Vite 7, TypeScript 5, Tailwind CSS 4, Contentful content management/delivery APIs, and Vercel Node functions. Native page navigation and prerendered HTML keep the public pages simple and fast.

Required pages: `/`, `/about`, `/solutions`, `/teams`, `/blog`, `/create-blog`, `/login`. Article detail pages use `/blog/:id`. Team profiles are fetched dynamically from Random User and clearly labelled as sample profiles.

## Run locally

```bash
npm ci
cp .env.example .env.local
# Set the Contentful API values and private editor/session credentials.
npm run dev
```

`npm run build` checks TypeScript, builds the application, and prerenders the public pages. `npm run test:flows` checks editor authentication, validation, origin protection, Contentful publishing, public retrieval, cookie tampering, and logout against a mocked Contentful contract. The contract checks do not replace live integration testing.

## Contentful setup

1. Create a Contentful account and a space. Copy its Space ID, create a Content Delivery API key, and create a Content Management API personal access token with write access. The Delivery API reads published content; the Management API is used by the server to create and publish articles. Keep both tokens server-side and out of GitHub.
2. This project is configured for Contentful's **Blog starter** model, whose content type API identifier is `pageBlogPost`. The website reads and writes these starter fields:

| Contentful field ID | Type |
|---|---|
| `internalName` | Short text |
| `slug` | Short text |
| `publishedDate` | Date |
| `title` | Short text |
| `shortDescription` | Long text |
| `content` | Rich text |
| `featuredImage` | Asset reference |

The Blog starter also adds optional author and SEO references. The website uses the first published sample post's featured image for articles created through its editor, so keep at least one published sample post with an image.

3. Note the space's default locale and environment ID (usually `master`). Set `CONTENTFUL_LOCALE` and `CONTENTFUL_ENVIRONMENT` to match.
4. Replace the starter sample post with wildfire field insight content and publish it. New articles submitted on the site are created through the Management API and published immediately.
5. Set `EDITOR_EMAIL`, `EDITOR_NAME`, and a long unique `EDITOR_PASSWORD` for the one website editor. These credentials are separate from your Contentful account; there is no public sign-up flow.
6. Set `SESSION_SECRET` to a random value of at least 32 characters. It signs the website's HttpOnly editor-session cookie.
7. Test editor login, article publication, article visibility while signed out, and logout before submission.

The public site reads entries using the Content Delivery API. The Management API token is only used by the server-side publishing route; it is never sent to browser code. Do not commit real tokens, editor credentials, or `.env.local`.

## Vercel deployment

Use the Vite preset. The repository includes `vercel.json`, a Node API entrypoint, and a `dist/client` output directory. Configure these server/build environment variables:

- `CONTENTFUL_SPACE_ID`, `CONTENTFUL_ENVIRONMENT`, `CONTENTFUL_LOCALE`: the Contentful space and model location.
- `CONTENTFUL_DELIVERY_TOKEN`: server-only read token for published content.
- `CONTENTFUL_MANAGEMENT_TOKEN`: server-only write token for article publishing.
- `EDITOR_EMAIL`, `EDITOR_NAME`, `EDITOR_PASSWORD`, `SESSION_SECRET`: server-only editor and session settings.
- `SITE_ORIGIN`: the final verified production HTTPS origin, used for canonical links and the sitemap.

Public pages can be viewed before configuration. The interface explicitly reports an unavailable content service and does not pretend that login or publication succeeded. Configure Contentful and test it before calling the project complete.

## Performance and accessibility

- Main desktop hero WebP: about 25 KB, with smaller mobile variants.
- Explicit image dimensions, reserved team loading cards, system fonts, and no autoplay video.
- Tailwind compiled at build time, no CSS CDN, third-party trackers, or animation library.
- Prerendered page headings, titles and descriptions; canonical links/sitemap use `SITE_ORIGIN`.
- Keyboard focus, a skip link, labelled forms, category buttons, responsive navigation, and reduced-motion support.
- Markdown is rendered as React elements. Raw HTML is escaped and unsafe link protocols are not activated.

Run PageSpeed Insights on the actual public production URL, on mobile and desktop. Do not present local bundle sizes or development timings as PageSpeed scores. Record all four categories for the required routes.

## Content and image references

- Wildfire solutions and product information: https://enterprise.dji.com/public-safety/wildfires
- Company information: https://www.dji.com/company
- Testimonial: Chief Richard Fields, LAFD, quoted in https://enterprise-insights.dji.com/user-stories/lafd-deploys-drones-for-more-effective-air-operations
- Logo, forest/field photographs, and drone images were obtained from the official reference page and optimized locally. They belong to DJI; this project claims no ownership of them.
- Team source: https://randomuser.me
- Journal entries are original portfolio summaries. Their dates identify sample editorial content; they are not represented as DJI announcements.

## Submission status

The site uses Contentful for published article delivery and server-side article creation. Local contract tests mock Contentful and verify editor authentication, validation, publication, retrieval, and logout; they do not replace live integration testing. Update this section with verified Contentful, deployment, performance, and presentation results before submitting.
