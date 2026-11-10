# Notices

## Brand assets (not covered by the MIT licence)

"Jinna", "CheckCheck", the Jinna logo (`client/src/components/ui/logos/logo-jinna.tsx`) and the sphere
artwork (`client/src/assets/jinna-sphere.png`, `client/public/favicon.png`) are trademarks and brand
assets of Jinna. They are included so the demo can be run as published. Do not use them to present
another product as Jinna's.

## Third-party software

No third-party source code is copied into this repository. It depends on the following packages,
installed from npm under their own licences (see each package's `LICENSE` file in `node_modules`):

| Package | Licence |
|---|---|
| react, react-dom, react-router-dom | MIT |
| express | MIT |
| vite, @vitejs/plugin-react | MIT |
| tailwindcss, tailwindcss-animate, @tailwindcss/typography, tailwind-merge | MIT |
| @radix-ui/react-popover | MIT |
| framer-motion | MIT |
| lucide-react | ISC |
| react-markdown, remark-gfm, remark-breaks, rehype-highlight | MIT |
| highlight.js | BSD-3-Clause |
| react-textarea-autosize, clsx, tsx, concurrently | MIT |
| dotenv | BSD-2-Clause |
| typescript | Apache-2.0 |

The popover wrapper in `client/src/components/ui/popover.tsx` follows the shadcn/ui pattern (MIT).

The Inter typeface is loaded from Google Fonts under the SIL Open Font Licence 1.1.

## Third-party services used at runtime

| Service | Used for | Terms |
|---|---|---|
| OpenRouter | Model access (`meta/muse-ember`) and the web search server tool | https://openrouter.ai/terms |
| Meta Muse Ember | The model | The provider's terms as presented by OpenRouter |
| Exa | Web search behind OpenRouter's search tool | https://exa.ai |
| rdap.org / registry RDAP servers | Domain registration records | Public registry data |
| UK Companies House API (optional) | Company register records | Crown copyright, Open Government Licence |
| OpenSanctions API (optional) | Sanctions and watch lists | https://www.opensanctions.org/licensing/ |
| Gravatar, Google favicon service | Header picture and site icons | Their respective terms |

Pages retrieved during a check belong to their publishers. A report quotes facts with a link to the
source; it does not republish pages.
