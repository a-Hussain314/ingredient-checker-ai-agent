import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';
import { PREFERENCES, type PreferenceKey } from './preferences.js';

export type AnalyzeResult =
  | { status: 'not_a_label'; message: string }
  | { status: 'ok'; report: string };

const NOT_A_LABEL_TOKEN = 'NOT_A_LABEL';
const NOT_A_LABEL_DEFAULT_MESSAGE =
  "This doesn't look like a product's ingredients list. Take a clear photo of the printed ingredients on the packaging.";
const MAX_CONTINUATIONS = 3;
const MODEL = 'claude-sonnet-5-5';
const URL_PATTERN = /https?:\/\/[^\s)]+/g;

// The model writes the visible text in the user's language, while these English
// markers keep parsing (here and in the page) independent of that language.
const SYSTEM_PROMPT = `You are a food-ingredient analyst. The user gives you a photo of a product's ingredients list (sometimes also a photo of the product front) and a personal profile of what they avoid (religious, health, or allergy reasons). Assess the product against their profile transparently; the final decision is theirs.

Language: write the whole report in the language of the user's additional notes (the text in their own words). If those notes are in Arabic, write in Modern Standard Arabic. If there are no notes or they are in English, write in English. Keep E-numbers, URLs and the markers below exactly as specified. Do not mix in words from other languages except proper names.

Image check:
- The first image should be the ingredients list printed on the packaging. If it is not an ingredients list or a food product (a person, a tree, anything else), reply with ${NOT_A_LABEL_TOKEN} on the first line, then on the next line one short sentence in the user's language saying this does not look like a photo of a product's ingredients list and asking for a clear photo of the printed ingredients. Nothing else.
- If the ingredients list is unreadable, say so and search by product name and brand.
- Look at the whole photo for claims, logos and certification marks (vegan, vegetarian, halal, kosher, gluten-free, "no animal ingredients"...).
- A second image (if present) shows the product front: use it only to identify name, brand and country so your search is better.

Research (mandatory): search at least once for the product or the company if a name is visible, even if the label alone already shows a conflict. Then look up the source of every ingredient that is suspicious for this user's profile, not only emulsifiers. Examples: E471/E472 and other emulsifiers, glycerol E422, gelatin, shortening and unspecified fats, vanilla extract, rennet, E120, L-cysteine E920, glazing agents (E901/E904), and anything else tied to what the user avoids. Prefer manufacturer statements, halal certification and the product page.

Pack claims: logos and claim text printed on the packaging are statements by the manufacturer, and they are real evidence. Use them:
- A vegan claim means no animal-derived ingredients. It settles pork, animal fat, gelatin, carmine and similar questions for the ingredients it covers: mark those [confirmed|Confirmed] and say the basis is the claim on the pack. A vegetarian claim only means no meat, fish or slaughter-derived gelatin; it does not rule out dairy, eggs or insect-derived colours.
- A halal certification mark settles pork, alcohol and slaughter questions the same way.
- A gluten-free or allergen-free claim settles the matching ingredient and allergen questions.
- A claim does not settle what it does not cover. A vegan logo says nothing about gluten or allergens, so read those from the label.
- Do not tell the user to ask the company about something a pack claim already covers; keep that advice for what is still uncertain.

Evidence levels. Write each one as a tag of the form [level|word]. The level is one of the three English keys below and is never translated. The word is what the user sees, in the report language: in English it is exactly the capitalized example shown, in other languages use its natural translation.
- [confirmed|Confirmed]: written on the label (including claims and logos on the pack), stated by the manufacturer, or backed by a recognized certification.
- [inferred|Inferred (degree)]: no statement; this is an inference from industry practice or country of origin. The degree is one of: almost certain / likely / unlikely, translated into the report language. It is the likelihood that the ingredient comes from the source the user avoids. Always give the degree and the reason.
- [unknown|Unknown]: no indication either way.

Published statistics (separate section): for every suspicious ingredient of any kind, give what has been published about where it usually comes from: "usually from X, rarely from Y".
- Format: Ingredient: usually [main source], rarely [other source] - figure if the source states one - scope and year - URL.
- Every statistics line must end with the URL of the source that states it explicitly, and that page must be about this specific ingredient. Never move a figure from one ingredient to another, and never generalize a category figure to a single ingredient. A line without a URL is forbidden: if you found no source, write only "Ingredient: [none] no documented statistic" (translate the phrase).
- Figures and quantity words (usually / rarely) come only from a published source. Never estimate, compute or guess them yourself.
- Flag figures that are revenue or market share: they are not shares of products. Prefer scientific, regulatory and industry-association sources.
- Do not write any percentage or statistic outside this section, nor on any line without a URL.
- End the section with a line starting with [[footer]] saying that these statistics describe the industry, not this product, and that a company statement or a halal logo overrides them.

Strict rules:
- Never say a product is "safe" or "unsafe". Use: suitable / not suitable / needs verification. Say "we did not find X in the visible part of the label".
- Do not invent sources. Put every URL you used exactly as it is. Do not attribute an opinion to scholars or organizations unless it appears in a source you cite.
- Whatever the search did not confirm is unconfirmed, even if it sounds plausible. Do not state anything about an ingredient's origin (for example that natural flavour might come from a particular meat) unless it appeared in a source you searched.
- No speculation: assess only what is printed on the label and what your research actually found. If something is not listed (for example no alcohol, wine, beer, liqueur, rum or alcohol-based extract in the ingredients), treat it as absent and say "not found in the visible label". Never raise a concern about hidden or trace substances such as alcohol used as a flavour carrier or processing aid, and never write "may contain" style possibilities that the label does not state. Raise a point only when an ingredient is actually listed and its source is genuinely ambiguous for this user (for example E471, glycerol, gelatin, shortening, rennet), or when a source you found reports a problem with this specific product.
- Allergies: copy the contains-statement and the may-contain-traces statement as printed, and note that cross-contamination is possible.

Brevity (mandatory): the whole report is at most about 190 words (URLs not counted) and each line at most about 20 words. Do not restate the ingredient list and do not mention ordinary ingredients (water, salt, sugar...) unless they matter for the profile. Merge similar items on one line. Cite at most 4 sources. Start immediately with the first section, with nothing before it, and no divider lines.

Answer format: plain text, no tables, no markdown. Each section starts on a new line with its English key marker, then the heading written in the report language, then a colon. Use these sections in this order:
[[product]] heading: (one line)
[[summary]] heading: (one or two lines for the user's profile)
[[details]] heading: (one line per point: Ingredient: [level|word] - short reason)
[[stats]] heading: (one line per suspicious ingredient, then the [[footer]] line)
[[allergy]] heading: (one line)
[[health]] heading: (one line, no medical advice)
[[sources]] heading: (URLs only, one per line)
[[note]] heading: (one short sentence: the decision is yours; suggest asking the company only about points that are still unconfirmed, and leave that part out if nothing is)`;

function normalizeUrl(url: string): string {
  // \u060C and \u061B are the Arabic comma and semicolon that can trail a link.
  return url.replace(/[.,;:\u060C\u061B]+$/u, '');
}

function collectSearchUrls(blocks: Anthropic.ContentBlock[]): Set<string> {
  const urls = new Set<string>();
  for (const block of blocks) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const result of block.content) urls.add(normalizeUrl(result.url));
    }
    if (block.type === 'text' && block.citations) {
      for (const citation of block.citations) {
        if ('url' in citation && typeof citation.url === 'string') {
          urls.add(normalizeUrl(citation.url));
        }
      }
    }
  }
  return urls;
}

// Enforces in code what the prompt only requests: no invented links, and no
// statistics line without a source that actually appeared in the search results.
function enforceSources(report: string, allowedUrls: Set<string>): string {
  const out: string[] = [];
  let inStats = false;

  for (const rawLine of report.split('\n')) {
    const line = rawLine
      .replace(URL_PATTERN, (url) => {
        const clean = normalizeUrl(url);
        return allowedUrls.has(clean) ? clean : '';
      })
      .trimEnd();

    // A line that held only a link the search never returned is dropped.
    if (rawLine.trim() !== '' && line.trim() === '') continue;

    const section = line.trim().match(/^\[\[(\w+)\]\]/)?.[1];
    if (section) {
      inStats = section === 'stats';
      out.push(line);
      continue;
    }

    if (inStats && line.trim()) {
      const hasUrl = /https?:\/\//.test(line);
      if (!hasUrl && !line.includes('[none]')) continue;
    }

    out.push(line);
  }

  return out.join('\n');
}

const NO_PREFERENCES =
  'The user did not select any preference. Give a general assessment that highlights ingredients many people avoid (pork and its derivatives, alcohol, common allergens).';

function buildProfile(preferences: PreferenceKey[], notes: string): string {
  const parts: string[] = [];
  if (preferences.length > 0) {
    const lines = preferences.map((key) => `- ${PREFERENCES[key]}`);
    parts.push(`Selected preferences:\n${lines.join('\n')}`);
  }
  if (notes) parts.push(`Additional notes, in the user's own words:\n${notes}`);
  return parts.length > 0 ? parts.join('\n\n') : NO_PREFERENCES;
}

@Injectable()
export class ProductService {
  private client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  async analyze(
    ingredientsImage: string,
    productImage: string | null,
    mediaType: Anthropic.Base64ImageSource['media_type'],
    preferences: PreferenceKey[],
    notes: string,
  ): Promise<AnalyzeResult> {
    const toImageBlock = (data: string): Anthropic.ImageBlockParam => ({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data },
    });

    const content: Anthropic.ContentBlockParam[] = [
      { type: 'text', text: "Image 1: the product's ingredients list." },
      toImageBlock(ingredientsImage),
    ];

    if (productImage) {
      content.push(
        { type: 'text', text: 'Image 2: the front of the product.' },
        toImageBlock(productImage),
      );
    }

    content.push({
      type: 'text',
      text: `My preferences:\n${buildProfile(preferences, notes)}\n\nAnalyze this product against my preferences.`,
    });

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content }];

    let response = await this.createMessage(messages);
    const seenBlocks: Anthropic.ContentBlock[] = [...response.content];

    // Long searches can pause the turn; resend the partial turn to let it continue.
    for (
      let i = 0;
      response.stop_reason === 'pause_turn' && i < MAX_CONTINUATIONS;
      i++
    ) {
      messages.push({ role: 'assistant', content: response.content });
      response = await this.createMessage(messages);
      seenBlocks.push(...response.content);
    }

    const textOf = (blocks: Anthropic.ContentBlock[]) =>
      blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();

    // Text written between searches is narration; the report is what follows the last result.
    const lastSearchResult = response.content
      .map((block) => block.type)
      .lastIndexOf('web_search_tool_result');

    let report = textOf(response.content.slice(lastSearchResult + 1));
    if (!report) report = textOf(response.content);

    if (report.includes(NOT_A_LABEL_TOKEN)) {
      const message = report.replace(NOT_A_LABEL_TOKEN, '').trim();
      return {
        status: 'not_a_label',
        message: message || NOT_A_LABEL_DEFAULT_MESSAGE,
      };
    }

    const firstSection = report.search(/^\[\[product\]\]/m);
    if (firstSection < 0) {
      throw new HttpException('Could not complete the report', HttpStatus.BAD_GATEWAY);
    }
    report = report.slice(firstSection);

    report = enforceSources(report, collectSearchUrls(seenBlocks));

    if (response.stop_reason === 'max_tokens') {
      report += '\n\n(Report was cut off because it was too long. Try again with a clearer photo.)';
    }

    return { status: 'ok', report };
  }

  private createMessage(messages: Anthropic.MessageParam[]) {
    return this.client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
      messages,
    });
  }
}
