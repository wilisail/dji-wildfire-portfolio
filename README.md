# DJI Enterprise — Wildfire company-profile portfolio

Code Challenge 2 by Wili K. An independent educational adaptation of DJI’s wildfire reference, not an official DJI website.

## Stack and routes

React 19, Vite 7, TypeScript 5, Tailwind CSS 4, Backendless REST authentication/content, and Vercel Node functions. Native page navigation and prerendered HTML keep the public pages simple and fast.

Required pages: `/`, `/about`, `/solutions`, `/teams`, `/blog`, `/create-blog`, `/login`. Article detail pages use `/blog/:id`. Team profiles are fetched dynamically from Random User and clearly labelled as sample profiles.

## Run locally

```bash
npm ci
cp .env.example .env.local
# Set the Backendless URL and a random server session signing secret.
npm run dev
```

`npm run build` checks TypeScript, builds the application, and prerenders the public pages. `npm run test:flows` checks authentication, validation, origin protection, publishing, public retrieval, cookie tampering, and logout against a mocked Backendless contract. The contract checks do not replace live integration testing.

## Backendless setup

1. Create a Backendless account and an application. In the app settings/API setup, obtain its public HTTPS `*.backendless.app` application URL. Set `BACKENDLESS_BASE_URL` to this URL (the server normalizes it to `/api`). App ID plus REST API key are also supported through `BACKENDLESS_APP_ID` and `BACKENDLESS_REST_API_KEY`, but the application URL is simpler.
2. In the Data section, create `BlogPosts`. Import `seed-posts.json` as the initial records, or create the columns below and import the records through the console. Keep the `Users` table separate.
3. In `Users`, create one editor with email, name, and a password. These are application-editor credentials, separate from the Backendless console account. No website registration flow or admin moderation is required by the brief.
4. On `BlogPosts`, allow public/anonymous **Find** and authenticated-user **Create/Add**. Deny anonymous writes and keep update/delete/permission management restricted. Grant authenticated users read access as well. On `Users`, retain protected user-data defaults; do not make passwords or user records public. Check role inheritance and explicit denies in the console.
5. Set a random `SESSION_SECRET` of at least 32 characters in the local/server environment. It seals the HttpOnly session cookie; it must never be included in frontend code or GitHub.
6. Verify a real login, article publication, article visibility from a separate signed-out browser, and logout before submission.

| BlogPosts column | Type |
|---|---|
| id | STRING, unique |
| title | STRING |
| excerpt | STRING |
| content | TEXT |
| category | STRING |
| tags | TEXT containing a JSON array |
| author | STRING |
| publishedAt | STRING containing an ISO timestamp |

The `content` and `tags` columns should support long text. Backendless also adds its own `objectId`, `created`, `updated`, and ownership fields. The server sends the signed-in user token on create requests, so Backendless permissions remain the authority for writes.

## Vercel deployment

Use the Vite preset. The repository includes `vercel.json`, a Node API entrypoint, and a `dist/client` output directory. Configure these server/build environment variables:

- `BACKENDLESS_BASE_URL`: public Backendless application URL.
- `SESSION_SECRET`: server-only random signing key.
- `SITE_ORIGIN`: the final verified production HTTPS origin, used for canonical links and the sitemap.

Public pages can be viewed before configuration. The interface explicitly reports an unavailable content service and does not pretend that login or publication succeeded. Configure Backendless and test it before calling the project complete.

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

Implementation and local contract checks are complete. The production build passes; twelve mocked publishing/security checks pass. Browser checks verified mobile navigation, live Random User profiles, category filtering, and the unauthenticated Create Blog redirect to Login. Live Backendless verification, Vercel publication, GitHub publication, PageSpeed measurement, and final presentation remain dependent on account/app configuration. Update this section with verified links and results before submitting.
