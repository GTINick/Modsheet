# ModSheet

A static site generated from data files.  No framework, no dependencies, no database.  Every car is one JSON file, and `node build.js` turns them all into the finished site in `dist/`.

## How it is organized

| Path | What it is |
| --- | --- |
| `site.json` | Brand name, wordmark, tagline, email, social links, disclosure.  Rename the site here in one place. |
| `content/builds/*.json` | One file per car.  This is the only thing the scout agent writes. |
| `schema/build.schema.json` | The contract every build file follows. |
| `assets/styles.css` | All styling.  Accent color is `--accent` at the top. |
| `build.js` | Reads the content, validates it, writes `dist/`. |
| `netlify.toml` | Tells Netlify to run the build and publish `dist/`. |

## The approval gate

Each build has a `status`:

* `draft`: written by the scout agent.  Not published.  The build log lists it so you know it is waiting.
* `soon`: shows as an "In the shop" teaser card.
* `live`: published as a full build sheet.

Approving a car means changing `draft` to `live` and pushing.  Nothing goes public without that edit.

The build also refuses to publish broken content.  A missing field, a bad slug or a bundle that points at a part that does not exist stops the deploy with a plain error message.

## Concepts

Set `"type": "concept"` on a build that is a studio render rather than a real car.  It gets a Concept tag on its card, on the home feature and on its sheet, a notice explaining that the car is a render, and the parts list is titled "The attainable version."  A live concept must name a `studio`, and every image must have `"render": true`, or the build stops.  Override the notice text with `conceptNote`.

## Links and affiliate links

Every part should link to a real product page, affiliate or not.  The button reads "Shop at" plus the `retailer` name.  When a program approves you, swap in the affiliate URL and set `"affiliate": true`; the link gets `rel="sponsored"` and a small Affiliate marker.  Leave `url` empty only if no source exists yet, and the button reads "Link soon."  Use `priceApprox` and `priceNote` for prices that vary or were converted from euros, and `also` for extra links such as a budget alternative.  Links must start with https:// or the build stops.  The build also stops if any affiliate link ships without `disclosure` in site.json, or an Amazon affiliate link ships without `amazonDisclosure` (Amazon requires that exact sentence; it only appears in the footer once an Amazon link is marked affiliate).  The privacy policy lives at /privacy/ and its copy is in `site.json` under `privacy`; update `privacy.updated` whenever it changes.

## The build article

`deck`, `article` and `updated` turn a build page into a full article: headline, standfirst, byline, hero image, numbered story sections with images from `gallery`, the designer's note as a pull quote, then the parts list at the bottom.  Update `updated` whenever you recheck prices.

## Photos and rights

The build refuses to publish a live sheet whose photo rights are not documented.  Set `photo.rights` to one of:

* `owned`: your own photo or render.  Add `"render": true` for concept renders so the caption says so.
* `licensed`: an open license such as CC BY or CC BY-SA.  Requires `license`, `licenseUrl` and `credit`.
* `permission`: the owner agreed in writing.  Requires `source.permission` set to `granted`, `source.owner` and `credit`.  Note where the yes lives in `source.permissionRecord`.

Instagram embeds are only allowed with `permission`.  Never download photos from Instagram, Pinterest, forums or auction listings; link to them instead.  The footer carries a takedown contact.

## Launch: fastest path (today, 2 minutes)

1. Go to app.netlify.com/drop.
2. Drag `modsheet-live.zip` onto the page.
3. It is live on a temporary netlify.app address.

## Launch: automation path (recommended next)

1. Create a free GitHub account and a private repo named `modsheet`.
2. Upload the contents of `modsheet-repo.zip`.
3. In Netlify: Add new site, Import from Git, pick the repo.  Netlify reads `netlify.toml` and builds on every push.
4. Site settings, Domain management: add mod-sheet.com and follow the DNS steps.

From then on, every new or approved build file that lands in the repo deploys itself.

## Local preview

```
node build.js
cd dist && python3 -m http.server 8000
```

Then open localhost:8000.
