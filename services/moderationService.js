/**
 * AI Content Moderation Service
 *
 * Screens user-generated content before it is persisted, using the existing Groq
 * client. Two independent checks, both fail-closed: any transport error or
 * unparseable payload raises ModerationUnavailableError so the caller rejects
 * instead of publishing. The reason is for server-side logs only.
 */

import { getGroqCompletion } from "./groqService.js";
import { assertBudgetAvailable, recordSpend } from "./tokenBudgetService.js";

// Scope is judged on its own model because Groq meters rate limits per model id
// and the chatbot shares 120b. Sharing it would make scope compete with chat
// traffic for the same 8K tokens/minute. Both models score 20/20 on the
// normal/borderline/unrelated set, so 20b costs no accuracy here.
const SAFETY_MODEL = "openai/gpt-oss-safeguard-20b";
const RELEVANCE_MODEL = "openai/gpt-oss-20b";

const MAX_CONTENT_CHARS = 4000;
// The models spend completion tokens on reasoning, and sometimes exhaust the cap
// before emitting anything at all: measured finish_reason "length" with empty
// content, which fail-closed turns into a 503 for a perfectly valid comment.
// 1200 is ample the rest of the time, so the truncated case gets one wider
// attempt rather than a permanently larger budget on every call.
const MAX_COMPLETION_TOKENS = 1200;
const RETRY_COMPLETION_TOKENS = 3000;

/**
 * Raised when a moderation decision could not be obtained at all.
 * Distinct from a successful "this content is not allowed" decision.
 */
export class ModerationUnavailableError extends Error {
  constructor(type, cause) {
    super(`Moderation unavailable for ${type}`);
    this.name = "ModerationUnavailableError";
    this.type = type;
    this.cause = cause;
  }
}

const SAFETY_POLICY = `# Community Contribution Safety Policy

## INSTRUCTIONS
You are a content safety classifier for a language-learning community website.
Classify the submitted user contribution against the policy below and return a
single JSON object with your decision and a brief justification.

Respond with JSON only, in exactly this shape:
{"allowed": true, "reason": "<explanation under 20 words>"}

Decide using these rules, in order:

1. SEXUAL CONTENT and HARASSMENT are judged strictly, and uncertainty means NOT
   allowed. Anything involving sexual attraction, sexual attention, nudity,
   flirting, soliciting a meeting or private contact, or belittling a person is
   not allowed. Never reclassify a message as innocent just because it also
   contains a polite, friendly, or academic sentence. A compliment or an offer
   of help does NOT cancel a sexual or harassing request made in the same
   message, and a request does NOT become acceptable because it was phrased as
   an offer to teach.

2. Every other VIOLATES category uses the ordinary standard: reject a clear
   violation, accept when genuinely uncertain.

3. Judge the meaning and context of the whole contribution rather than isolated
   words, except for rule 1, where sexual or harassing content anywhere in the
   message is sufficient on its own.

## VIOLATES (allowed = false)

### SEXUAL CONTENT - reject all of it
Learners of every age use this site, including minors, and members meet each
other for the first time to exchange languages. Any sexualised material is
therefore a violation, regardless of who it appears to involve:
- Any sexual, erotic, sensual, suggestive, or flirtatious content or description
- Nudity, partial nudity, or anything sexualised, in text, in an image link, or
  in a profile name, avatar, or display name
- Sexual or romantic solicitation, propositions, flirtation, or advances aimed
  at another person, including "private" messages, contact details, or an offer
  to meet
- Any invitation to meet, chat privately, exchange contact details, or move
  off-platform when it is paired with compliments about appearance, is vague
  about what would actually be taught, or is addressed to one specific member
  rather than to the community. Treat this as solicitation even when the
  message also mentions studying, a language, or a course
- Sexting, sending or requesting sexual messages, pictures, or media
- Sexualised roleplay, innuendo used to target someone sexually, or remarks
  about a person's body, clothing, or appearance in a sexual way
- Sexual content involving minors in any form, or any grooming behaviour
- Pornography, escort or sex-work advertising, or links to any of the above
- A bare or standalone sexual term used as the whole contribution, with no
  educational, linguistic, or health framing. A one-word comment is not a
  language lesson. A sexual term inside a real question about the word, a
  lesson, or health information is still allowed, and the same word judged in
  that context is not a violation.
Apparent consent between adults does NOT make sexual content acceptable here.
The only sexual material that may pass is clinical, biological, or sex-education
content that is factual and educational in tone, with no sexualisation, no
solicitation, and no explicit personal detail.

### HARASSMENT - reject all of it
Harassment targets a person. Criticism targets an idea. That distinction is the
whole test:
- Insults, name-calling, slurs, or demeaning attacks aimed at a person or group
- Bullying, intimidation, stalking, or repeated unwanted contact
- Threats or intimidation of violence, including threats made indirectly
- Sexual harassment, sexual attention, or sexualised comments about a person
- Demeaning generalisations about a nationality, ethnicity, religion, gender,
  disability, or any other protected characteristic
- Mocking a person's appearance, disability, poverty, accent, or language
  mistakes where the purpose is to belittle them rather than to help
- Shaming, pressuring, or publicly exposing someone to force them to act
- Sexual attention or advances directed at a specific member, especially a minor
  or a teacher
Describing an attack as "just feedback", "just joking", "just banter", or "just
criticism" does NOT make it safe. Criticising a book, a method, a course, a
policy, or the platform is allowed; demeaning a person is not.

### OTHER VIOLATIONS
- Hateful content targeting a protected characteristic, or content denying the
  Holocaust / glorifying genocide
- Instructions or encouragement of self-harm, suicide, or disordered eating
- Content that facilitates real-world harm: how to make weapons, drugs,
  explosives, or how to carry out a crime, hack, or fraud
- Sharing private personal data (addresses, phone numbers, identity documents)
  about a private individual
- Spam, scams, phishing, or advertising that is not relevant to the community

## SAFE (allowed = true)
- Ordinary discussion, opinions, disagreement, debate, or criticism of ideas
- Difficult or challenging questions, homework help, exam questions
- Controversial or sensitive subjects discussed for educational, historical,
  academic, or linguistic purposes
- Sensitive terminology appearing in a legitimate educational, linguistic,
  historical, or translation context. The presence of a term on its own is
  NEVER a violation. Judge whether it is used to harm, abuse, or sexualise
  someone, versus discussed, taught, criticised, or explained.
- Language practice: grammar corrections, vocabulary, translation help,
  pronunciation, idiom explanations. Being about language or study does NOT by
  itself make a message safe: a private meeting invitation, an offer to teach
  something vague, or contact details are judged under SEXUAL CONTENT above
- Constructive feedback about a user's writing or a teacher's lesson, aimed at
  improving the work rather than belittling the author
- Critiques of a course, a method, a policy, or the platform itself
- Political, religious, or social commentary that does not target a group with
  hatred or call for harm
- Anything ambiguous or uncertain. The single exception: for sexual content and
  for harassment, if you are genuinely unsure, set allowed to FALSE. Erring
  toward rejecting those two categories is the correct choice.

## EXAMPLES

Content: "Your explanation of the subjunctive was wrong and the textbook is bad."
Answer: {"allowed": true, "reason": "Criticism of teaching material with no personal attack."}

Content: "How do I use the conditional in French? I keep mixing up si and quand."
Answer: {"allowed": true, "reason": "Straightforward grammar question."}

Content: "Students often ask why the word 'nigga' is offensive. Here is its history in African American English and why it is reclaimed."
Answer: {"allowed": true, "reason": "Sensitive term explained in an educational linguistic context."}

Content: "The Holocaust denial movement spreads the myth that it never happened."
Answer: {"allowed": true, "reason": "Mentions Holocaust denial in order to criticise it, not to deny it."}

Content: "Everyone from that country is lazy parasites and should be thrown out."
Answer: {"allowed": false, "reason": "Dehumanising generalisation against a national group."}

Content: "What's the best way to hurt someone without leaving marks?"
Answer: {"allowed": false, "reason": "Requests instructions for physical violence."}

Content: "Check out my crypto site, send me your seed phrase and I will double your money."
Answer: {"allowed": false, "reason": "Phishing scam targeting credentials."}

Content: "Hey, I am 24 and I am into you. Send me a photo on Telegram, nobody else has to know."
Answer: {"allowed": false, "reason": "Sexual solicitation and a request for intimate images from a stranger."}

Content: "Her legs were showing in that photo and everyone was staring. I would have asked her out if she were more relaxed."
Answer: {"allowed": false, "reason": "Sexualises and objectifies a specific person."}

Content: "Hot girls near you, anonymous sex tips, meet me tonight at example dot com"
Answer: {"allowed": false, "reason": "Pornographic advertising and solicitation."}

Content: "Come to my place tonight, I want to show you how French really sounds."
Answer: {"allowed": false, "reason": "Sexual invitation dressed as a language-exchange offer."}

Content: "As a biology teacher I explained to my class that a boy's voice changes at puberty because the larynx grows. Here is the lesson plan."
Answer: {"allowed": true, "reason": "Factual sex-education material in a teaching context."}

Content: "Do not worry, I make mistakes in French too and your accent is fine. Let us practise the subjunctive together."
Answer: {"allowed": true, "reason": "Supportive language practice with no belittling."}

Content: "Just some honest feedback: this is the worst explanation of the subjunctive I have ever read, and you clearly did not understand it yourself."
Answer: {"allowed": false, "reason": "Personal attack on the author disguised as feedback."}

Content: "I am only joking when I say you are too stupid to teach this."
Answer: {"allowed": false, "reason": "Harassment of a person; claiming it is a joke does not excuse it."}

Content: "You keep messaging me after I asked you to stop."
Answer: {"allowed": false, "reason": "Repeated unwanted contact after a clear refusal."}

Content: "sex"
Answer: {"allowed": false, "reason": "A bare sexual term standing alone is neither a lesson nor a health question."}

Content: "Sex?"
Answer: {"allowed": false, "reason": "Standalone sexual term used as the entire comment."}

Content: "In Italian, does sesso also mean six, or am I misremembering?"
Answer: {"allowed": true, "reason": "A genuine question about what an Italian word means."}

Content: "French has two similar words, sexe and six. How do I tell them apart when I speak?"
Answer: {"allowed": true, "reason": "A real question about a distinction between two French words."}

Content to classify:`;

const RELEVANCE_POLICY = `# Blog Scope Policy

## INSTRUCTIONS
You decide whether a blog post belongs on a multilingual language-learning
community website. Mulinguae (ACS Mulinguae) exists so people can learn
languages with native speakers, exchange languages, and connect worldwide.

Classify the blog post against the site scope below and return a single JSON
object, JSON only, in exactly this shape:
{"relevant": true, "reason": "<short explanation>"}

Judge the post's actual purpose and meaning, not isolated keywords. A post that
touches a sensitive subject can still be relevant when its real purpose is
linguistic or educational. When genuinely uncertain, set relevant to true.

## IN SCOPE (relevant = true)
- Language learning, teaching, acquisition, or study tips
- Grammar, vocabulary, pronunciation, spelling, writing skills
- Translation, interpretation, and comparing languages
- Linguistics and language families
- Multilingualism, code-switching, and language communities
- Endangered, minority, indigenous, or heritage languages and their preservation
- Language and cultural learning, cultural notes tied to language use
- Teaching methodology, classroom practice, and study advice
- Experiences of learning or teaching a language
- Reviews or recommendations of language-learning courses, teachers, or tools
- Immigration, identity, or social topics where language learning is central
- Blogs about the platform's own courses, teachers, or community features
- General education, learning, educational development, and the importance of education
- Educational topics intended to help students, teachers, learners, or the broader learning community

## OUT OF SCOPE (relevant = false)
- General news or current-events commentary with no language-learning angle
- Politics with no language or education angle
- Sports, entertainment, celebrity gossip, or lifestyle content
- Finance, crypto, investments, or business advice
- Medicine, legal, or financial advice
- Generic marketing, advertising, or spam
- Content whose purpose is to drive traffic elsewhere rather than teach

## EXAMPLES

Title: "Five German cases every learner forgets"
Answer: {"relevant": true, "reason": "Directly about German grammar for learners."}

Title: "Why Quechua verbs conjugate differently than Romance languages"
Answer: {"relevant": true, "reason": "Linguistics comparing language families."}

Title: "Recording the last speakers of a language with no written form"
Answer: {"relevant": true, "reason": "Endangered language preservation and documentation."}

Title: "A short film I watched last weekend and what I thought of it"
Answer: {"relevant": false, "reason": "Entertainment review with no language-learning content."}

Title: "Which cryptocurrency should I invest in this year?"
Answer: {"relevant": false, "reason": "Investment advice outside the site's scope."}

Title: "Why the word 'illegal' appears in everyday conversation"
Answer: {"relevant": true, "reason": "Explains how a politically sensitive term is actually used in language."}

Post to classify:`;

const truncate = (value, max = MAX_CONTENT_CHARS) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
};

// Tolerates markdown fences and surrounding prose; null when nothing is usable.
const extractJsonObject = (raw) => {
  if (typeof raw !== "string") return null;

  const unfenced = raw.replace(/```json/gi, "").replace(/```/g, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) return null;

  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
};

/**
 * Pure and exported so the fail-closed contract is directly testable: anything
 * that is not a well-formed object with a boolean `field` is a moderation
 * failure, never an implicit "safe".
 *
 * @param {unknown} raw - the model's message content
 * @param {string} field - "allowed" or "relevant"
 * @returns {{value: boolean, reason: string}}
 * @throws {ModerationUnavailableError}
 */
export const parseModerationVerdict = (raw, field) => {
  const parsed = extractJsonObject(raw);

  if (!parsed || typeof parsed[field] !== "boolean") {
    throw new ModerationUnavailableError(field);
  }

  return {
    value: parsed[field],
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
};

/**
 * @returns {Promise<{allowed?: boolean, relevant?: boolean, reason: string}>}
 * @throws {ModerationUnavailableError} on transport failure or bad payload
 */
const runModerationPrompt = async ({ type, model, policy, subject, field }) => {
  const messages = [
    { role: "system", content: policy },
    { role: "user", content: subject },
  ];

  // Each attempt is budgeted and accounted for on its own, so a retry cannot
  // slip past the daily guard and its tokens are recorded as they are spent.
  const attempt = async (maxTokens) => {
    // Checked before the call so an exhausted day refuses the work instead of
    // spending it. A guard failure is indistinguishable from any other
    // unavailable moderator, which is the intent: fail closed.
    await assertBudgetAvailable(model);

    const completion = await getGroqCompletion({
      messages,
      model,
      temperature: 0,
      maxTokens,
      stream: false,
      // Backoff is 3s/6s/12s: giving up early turns a rate limit into a
      // rejection of a comment that is perfectly fine.
      maxRetries: 4,
      retryDelayMs: 3000,
    });

    // Accounted for a completed call, and never allowed to fail the submission:
    // these tokens are already spent.
    await recordSpend(model, completion?.usage);

    return completion;
  };

  // Null instead of throwing, so a retry can be decided on the result.
  const readVerdict = (completion) => {
    try {
      return parseModerationVerdict(
        completion?.choices?.[0]?.message?.content,
        field,
      );
    } catch {
      return null;
    }
  };

  const send = async (maxTokens) => {
    try {
      return await attempt(maxTokens);
    } catch (error) {
      console.error(
        `[moderation] ${type} request failed (model=${model})`,
        error?.message,
      );
      throw new ModerationUnavailableError(type, error);
    }
  };

  let completion = await send(MAX_COMPLETION_TOKENS);
  let verdict = readVerdict(completion);

  // Only the truncated case is retried: a payload that is present but not JSON
  // is a different fault, and retrying it would spend tokens for nothing.
  if (!verdict && completion?.choices?.[0]?.finish_reason === "length") {
    console.warn(
      `[moderation] ${type} used its whole completion budget without output; retrying once`,
    );
    completion = await send(RETRY_COMPLETION_TOKENS);
    verdict = readVerdict(completion);
  }

  if (!verdict) {
    console.error(
      `[moderation] ${type} returned an unusable result (model=${model})`,
    );
    throw new ModerationUnavailableError(type);
  }

  return { [field]: verdict.value, reason: verdict.reason };
};

/**
 * Safety check. Comments and replies get no relevance check, only this.
 *
 * @param {{content: string, type?: string}} input
 * @returns {Promise<{allowed: boolean, reason: string}>}
 * @throws {ModerationUnavailableError}
 */
export const moderateSafety = async ({ content, type = "comment-safety" }) => {
  const subject = truncate(content);

  if (!subject) {
    // Nothing to classify is a validation concern, not a moderation failure.
    return { allowed: true, reason: "empty content" };
  }

  const result = await runModerationPrompt({
    type,
    model: SAFETY_MODEL,
    policy: SAFETY_POLICY,
    subject,
    field: "allowed",
  });

  console.log(
    `[moderation] ${type} allowed=${result.allowed} model=${SAFETY_MODEL}`,
  );
  return { allowed: result.allowed, reason: result.reason };
};

/**
 * Runs only after the safety check passes. BlogPost has no category or tags, so
 * title, subtitle and body are the whole signal.
 *
 * @param {{title?: string, subTitle?: string, content?: string}} input
 * @returns {Promise<{relevant: boolean, reason: string}>}
 * @throws {ModerationUnavailableError}
 */
export const moderateRelevance = async ({
  title = "",
  subTitle = "",
  content = "",
}) => {
  const post = [
    `Title: ${truncate(title, 200)}`,
    subTitle ? `Subtitle: ${truncate(subTitle, 200)}` : null,
    `Body: ${truncate(content)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await runModerationPrompt({
    type: "blog-relevance",
    model: RELEVANCE_MODEL,
    policy: RELEVANCE_POLICY,
    subject: post,
    field: "relevant",
  });

  console.log(
    `[moderation] blog-relevance relevant=${result.relevant} model=${RELEVANCE_MODEL}`,
  );
  return { relevant: result.relevant, reason: result.reason };
};

/**
 * Safety first, then scope; a rejection on either stops the pipeline.
 *
 * @param {{title?: string, subTitle?: string, content?: string}} input
 * @returns {Promise<{allowed: boolean, relevant: boolean, reason: string}>}
 * @throws {ModerationUnavailableError}
 */
export const moderateBlogPost = async ({ title, subTitle, content }) => {
  const safety = await moderateSafety({
    content: `${title || ""}\n\n${subTitle || ""}\n\n${content || ""}`,
    type: "blog-safety",
  });

  if (!safety.allowed) {
    return { allowed: false, relevant: false, reason: safety.reason };
  }

  const relevance = await moderateRelevance({ title, subTitle, content });

  return {
    allowed: true,
    relevant: relevance.relevant,
    reason: relevance.reason,
  };
};

export default {
  moderateSafety,
  moderateRelevance,
  moderateBlogPost,
  ModerationUnavailableError,
};
