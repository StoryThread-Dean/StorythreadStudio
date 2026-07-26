// data/traitPools.ts -- Curated pools for the side-character trait randomizer
// ============================================================================
// The Quick Build panel rolls a handful of options per section (Physical /
// Mannerism / Voice / Want) from these pools; clicking an option appends it
// to the side-character template's section text. Everything here is static
// text shipped with the app -- no AI calls, instant, hand-editable after
// insert.
//
// Pool tiers (the NSFW toggle semantics the writer chose):
//   - toggle OFF               -> `normal` options only; Explicit box greyed out
//   - toggle ON                -> `nsfw` options REPLACE normal ones
//   - toggle ON + Explicit box -> `explicit` options REPLACE the nsfw ones;
//     this spiciest tier favors fill-in-the-blank phrasing ("secretly wants
//     to be ____") so the writer personalizes instead of the app prescribing.
//
// Archetype weighting: ARCHETYPE_FLAVOR adds role-specific options to the
// FRONT of the shuffle for the chosen story role, so even random picks land
// vaguely coherent. Flavor applies to the normal tier only.
//
// Repeat protection: rollTraitOptions accepts an `exclude` set of options
// already shown, and deals from the rest of the pool until it runs dry --
// so rerolling pages through the whole pool before anything comes back.

export type TraitSection = "physical" | "mannerism" | "voice" | "want" | "hidden";

export interface TraitPool {
  normal: string[];
  nsfw: string[];
  explicit: string[];
}

export const TRAIT_POOLS: Record<TraitSection, TraitPool> = {
  physical: {
    normal: [
      "a gentle giant -- fills the doorway, speaks just above a whisper, and handles everything like it might break",
      "impossibly perfect hair no matter the weather, and everyone quietly resents asking how",
      "a permanent scowl that has nothing to do with their mood, which confuses every stranger they meet",
      "small and quick, always underfoot before anyone hears them coming, like the room grew them",
      "an old injury that announces the weather a full day before it turns, and they trust it over any forecast",
      "dresses a full generation out of date, on purpose, and somehow makes everyone else look wrong",
      "hands that never stop working -- whittling, mending, peeling -- even in the middle of an argument",
      "a laugh you can locate from two rooms away, and people navigate parties by it",
      "immaculate except for one chaotic detail they either don't know about or fiercely defend",
      "built like a scarecrow, all angles and joints, and folds into chairs like a collapsing easel",
      "a face that looks familiar to absolutely everyone, and they are exhausted by being someone's cousin",
      "always slightly sunburned whatever the season, as if the sun holds a personal grudge",
      "moves like they own the floor, even in someone else's house, even at a funeral",
      "one gold tooth with a different origin story every time someone is brave enough to ask",
      "wears the same coat regardless of occasion, and it has more pockets than seems physically possible",
      "startlingly pale eyes that make people confess things they meant to keep",
      "a boxer's nose on an otherwise gentle face, and they never explain it",
      "smells faintly of woodsmoke and oranges wherever they go, and no one has found the source",
      "tall enough to duck through doorways out of habit, even the ones they'd clear",
      "a limp that vanishes entirely when they think nobody is watching",
      "scarred knuckles and reading glasses -- a combination that stops conversations",
      "hair gone white early, which they insist happened in a single night",
      "wears rings on every finger and clicks them against tables in patterns that mean something",
      "the deep tan and squint of someone who has spent forty years looking at horizons",
      "delicately built but carries heavy things out of pure spite when doubted",
      "a voice-stopping birthmark they have long since stopped noticing, which unsettles people more",
      "always cold -- gloves in summer, blanket over the knees, tea going constantly",
      "always overheated -- sleeves rolled in winter, complains the fire is too high",
      "keeps their hat on indoors and treats requests to remove it as opening negotiations",
      "a magnificent mustache or braid maintained with more care than any other part of their life",
      "stands with military stillness that makes everyone else fidget worse",
      "chews on a pipe stem, toothpick, or pencil that is never actually lit, eaten, or used",
      "freckles that multiply visibly across a summer, like a time-lapse of the season",
      "one ear that doesn't hear, and they choose strategically who stands on that side",
      "the softest hands in town on someone with the hardest reputation",
      "a collection of tiny scars with a story for each, most of them contradictory",
      "dresses entirely in one color and has never once explained it",
      "an elaborate tattoo that only partially shows at the collar, inviting a lifetime of speculation",
      "walks everywhere with a stick they clearly do not need and clearly will not surrender",
      "eats constantly and stays wiry, which their friends find genuinely offensive",
      "a jaw that clenches visibly when lying -- known to everyone in town except them",
      "beautiful in old photographs on the wall, and daring you to comment on the difference",
      "carries a cat, dog, or bird most places and defers to its judgment of strangers",
      "hunched from decades at a workbench, straightening only when truly angry -- a warning sign locals know",
      "big, expressive eyebrows that conduct every conversation like an orchestra",
      "moves through crowds without touching anyone, like water finding gaps",
      "smudged spectacles pushed up so often it reads as punctuation",
      "burn scars on one forearm, always uncovered, never discussed",
      "the kind of tired that has settled into the bones and become a personality",
      "wears their late spouse's watch, wound daily, set seven minutes fast for reasons they keep",
      "a gap-toothed grin deployed like a weapon at precisely the wrong moments",
      "so nondescript that witnesses genuinely cannot describe them afterward, which they cultivate",
      "crooked fingers from a trade they no longer practice and won't name",
      "dyes their hair a defiant, unmissable color and re-dyes it the day roots show",
      "smiles with the mouth only; the eyes stay busy doing arithmetic",
      "a heavy brass keyring on their belt that jingles their arrival a corridor away",
    ],
    nsfw: [
      "the kind of good-looking that makes people forget their errand halfway through a sentence",
      "dresses one deliberate notch too provocatively for every occasion, including funerals",
      "a body kept gym-perfect purely to be looked at, and they audit who's looking",
      "a slow, deliberate way of moving that reads as an invitation and is meant to",
      "always a little undone -- one button, one strap, one glance past decency",
      "scandalous ink that only shows when they want it to, revealed like a card trick",
      "a mouth made for smirking and worse, and they know exactly which",
      "beautiful in a way they weaponize without apology or discount",
      "a throat-first way of laughing that turns heads and ruins trains of thought",
      "chooses chairs, doorframes, and railings to lean on like the room is a photoshoot",
      "the physique of someone's very specific fantasy, and they have made it a business model",
      "perfume or cologne applied as a territorial claim -- rooms remember they were there",
      "an unhurried stretch performed for audiences, complete with eye contact",
      "lipstick or collar always immaculate, which somehow suggests exactly the opposite",
      "a dancer's control of every muscle, spent generously on walking past people",
      "heat radiates off them like a stove; standing close feels like a decision",
      "dresses respectable to the collar and scandalous past the cuff, if you catch the details",
      "the confident undress of a lifeguard in any climate, at any occasion",
      "a bitten-lip habit that they deploy consciously and deny completely",
      "built like temptation and dresses like they lost a bet with modesty",
    ],
    explicit: [
      "keeps ____ under their clothes that nobody in town would guess, and exactly one person knows",
      "a body that shows exactly what ____ did to it, and they wear the evidence proudly",
      "dresses like ____ in public and like ____ when the door locks",
      "the marks of last night's ____ just barely covered by the collar, on purpose",
      "openly wears the ____ that signals what they're into, if you know how to read it",
      "a physical tell -- ____ -- that gives them away instantly when aroused",
      "keeps their ____ shaved, oiled, or adorned in a way only lovers ever discover",
      "under the workday clothes, ____ -- and the contrast is the whole point",
      "a piercing or mark at ____ that they reveal as a test of nerve",
      "their body responds visibly to ____, which makes certain rooms very complicated",
      "carries themselves like someone who was ____ last night and intends to be again",
      "the outline of ____ occasionally visible, never acknowledged, always deliberate",
      // Filled-in inspiration -- concrete enough to spark a deviation of
      // the writer's own; roughly half the tier stays fill-in-the-blank.
      "a lover's initials inked where only bathwater and one other person have ever seen them",
      "rope marks at the wrists just under the cuffs, refreshed often enough to stay tender",
      "a faint collar of bruises appears after market days, worn open-throated, daring comment",
      "a pierced nipple that shows through summer linen, which is exactly why they wear summer linen",
      "dresses for church like a penitent and undresses, per one reliable account, like a professional",
      "keeps everything below the collar shaved and oiled, a discipline maintained for an audience of one",
      "moves with the loose-limbed ease of someone thoroughly enjoyed the night before, most nights",
      "thighs marked with the neat crescents of someone's nails, renewed with calendar regularity",
      "a silk ribbon knotted at the ankle -- a signal, an invitation, and a receipt, depending who asks",
      "wears a corset laced by someone else's hands, and the whole street can tell the mornings nobody laced it",
    ],
  },

  mannerism: {
    normal: [
      "perfect comedic timing -- the quip lands exactly on the beat, every time, even at their own expense",
      "never finishes a sentence, trusting you to catch the drift, and gets wounded when you don't",
      "polishes things that are already clean when nervous; the counter shines in proportion to the crisis",
      "quotes their late spouse like scripture, at least twice a conversation, with fresh grief and fresh comedy",
      "counts things under their breath -- stairs, coins, people -- and restarts if interrupted",
      "touches the doorframe twice before entering any room and pretends it's checking the paint",
      "feeds everyone within reach; refusing a plate is treated as a formal declaration of war",
      "collects gossip like currency, spends it strategically, and never reveals the exchange rate",
      "apologizes to furniture when bumping into it and means it more than most human apologies",
      "writes everything on their palm and washes none of it off; their hand is a ledger",
      "hums old songs slightly wrong, daring the room to correct them, keeping score of who tries",
      "always mid-card-trick or coin-roll; the hands perform even when the face is elsewhere",
      "remembers everyone's usual order, full name, and worst secret, in that order of importance",
      "leaves every gathering exactly ten minutes before it ends, and is somehow never seen going",
      "names inanimate objects and holds grudges against specific ones, especially the ladder",
      "keeps a running commentary on the weather like it's a personal rivalry with the sky",
      "stacks, straightens, and aligns whatever is on the table while talking, then denies doing it",
      "takes off their glasses to deliver bad news, a tell the whole village has learned to dread",
      "laughs a beat before the joke finishes, having already seen where it lands",
      "carries hard candy or nuts to bribe children, dogs, and difficult adults, in the same pocket",
      "refuses to sit with their back to a door and rearranges other people's furniture to avoid it",
      "answers knocks by shouting the visitor's name before seeing them, and is unnervingly accurate",
      "presses gifts on departing guests -- eggs, cuttings, pamphlets -- refusing refusal",
      "sharpens, oils, or tunes something during every serious conversation, finishing exactly as it resolves",
      "crosses the street to read every posted notice, then reports the town's business unprompted",
      "does sums out loud, wrongly, until someone corrects them, which was the plan all along",
      "collects small debts of favor and calls them in years later with perfect recall",
      "insists on shaking hands with everyone, twice, arrival and departure, no exceptions",
      "swats at flies that no one else ever sees, mid-sentence, without losing their place",
      "measures all distances in odd personal units -- 'three donkey-carts down, past the widow's fence'",
      "cleans their nails with a pocketknife during negotiations, which does most of the negotiating",
      "keeps checking a watch, letter, or door with escalating frequency as evening comes on",
      "repeats the last three words of whatever you said, last three words you said, before answering",
      "waves at every vehicle, boat, or rider that passes, and files away which ones wave back",
      "argues with the newspaper, radio, or town crier out loud like the reply might be printed",
      "saves the good chair, the good cups, and the good tea for a guest who never quite comes",
      "abruptly weeds, sweeps, or tidies public spaces mid-walk, muttering about standards",
      "assigns everyone a nickname within a minute of meeting them, and the nickname sticks for life",
      "raises one finger for silence, holds it for effect, then says something entirely mundane",
      "sniffs food, letters, coins, and strangers with the same open suspicion",
      "keeps score in games nobody agreed to be playing -- doors held, greetings returned, pies delivered",
      "collects rocks, buttons, or bottle caps from meaningful places and can recite the provenance of each",
      "practices arguments alone; passersby report entire two-sided shouting matches through the window",
      "checks their reflection in every surface, not from vanity but as if confirming they're still there",
      "sighs theatrically before agreeing to things they were always going to do",
      "taps out messages on tabletops in some private code, and stops if you look",
      "peels every label off every bottle in reach and folds the paper into tiny squares",
      "walks the same route at the same hour so reliably that neighbors set their clocks by it",
      "wraps and re-wraps a scarf, shawl, or bandage as a way of ending conversations",
      "prays, knocks wood, and salutes magpies indiscriminately -- covering, they say, all offices",
      "brings up their one trip abroad within minutes, then defends it like territory",
      "will not step on thresholds, cracks, or the third stair, and has stopped explaining why",
      "adopts every stray animal within a mile and denies each one is theirs while feeding it",
      "hoards string, jars, and nails 'for later,' and later has never once come",
      "recites the family tree of anyone mentioned, back four generations, unasked",
      "falls asleep instantly and anywhere, mid-gathering, and wakes precisely when discussed",
    ],
    nsfw: [
      "flirts on reflex with anything that makes eye contact, including portraits and statuary",
      "stands one deliberate step inside everyone's personal space and enjoys who steps back",
      "turns any innocent sentence filthy with a pause placed like a chess move",
      "touches your arm mid-sentence and lets it linger exactly one beat past friendly",
      "undresses people with a glance and doesn't pretend otherwise when caught",
      "keeps a count of conquests somewhere -- notches, beads, a ledger -- and lets it be glimpsed",
      "bites their lip when scheming, and they are always, always scheming",
      "whispers things in public that belong behind locked doors, at fully audible volume",
      "greets attractive strangers with a slow inventory before the hello",
      "adjusts other people's collars, lapels, and hair without asking, as a form of conversation",
      "sits, stands, and bends with a theatricality that has caused minor traffic incidents",
      "gives compliments that require a cold drink afterward",
      "leaves the top of everything unbuttoned and blames every climate for it",
      "writes their room number on things -- napkins, palms, receipts -- with terrifying efficiency",
      "dances with everyone at every event, each partner briefly convinced they are the only one",
      "asks 'your place or mine' as casually as asking the time, and means it exactly that little",
      "trails a fingertip along railings, tables, and shoulders alike while crossing any room",
      "laughs low and private at public jokes, as if they and the joke have a history",
      "remembers every romance in town, past and pending, and forecasts new ones with unsettling accuracy",
      "treats mirrors as colleagues -- a nod, a wink, an understanding",
    ],
    explicit: [
      "propositions ____ within minutes of meeting them, as a kind of formal greeting",
      "has a tell when aroused -- ____ -- that regulars at the tavern read like a weather vane",
      "keeps a ____ in their bag at all times and a well-rehearsed story about it ready",
      "negotiates ____ with the bored calm of someone ordering their usual coffee",
      "can't share a room with ____ without steering the whole night in that direction",
      "leaves ____ behind after every encounter, like a calling card nobody asked for",
      "openly rates every newcomer's ____ on a scale only they fully understand",
      "schedules their week around ____, and everyone who knows them can read the calendar",
      "flirts by demonstrating ____, which has emptied rooms and filled others",
      "keeps trophies of ____ arranged where guests will definitely ask",
      "practices ____ so loudly the neighbors have organized twice",
      "answers the door dressed for ____ regardless of who knocked",
      // Filled-in inspiration -- half the tier stays blank for the writer.
      "unlaces, unbuttons, or unpins exactly one item the moment a door locks, on reflex",
      "kneels to tend the fire with a practiced grace that has nothing to do with fires",
      "keeps a riding crop by the door of a house that has never owned a horse",
      "bites, and regards the marks left on lovers as a form of correspondence",
      "insists on undressing partners fully and slowly, folding each piece like a ceremony",
      "collects lovers' buttons, laces, and pins as trophies, worn openly and sorted by conquest",
      "practices intricate rope knots on the porch railing while chatting about the weather",
      "answers the late knock in nothing but the good dressing gown, already untied",
      "palms the host's bedroom key at every party and returns it at dawn, unashamed",
      "arranges assignations by leaving one glove on the market stall of the evening's chosen",
    ],
  },

  voice: {
    normal: [
      "dry one-liners delivered completely deadpan, so half the town has no idea they're funny",
      "talks to strangers like regulars at a bar they own, and somehow the strangers accept this",
      "asks questions relentlessly and answers none, a trade imbalance nobody has managed to correct",
      "swears in an inventive, oddly wholesome way -- 'son of a biscuit-eating mule' -- with total sincerity",
      "speaks in stories that always circle back to a point, eventually, via three unrelated funerals",
      "a whisper people lean into, which is exactly the plan, and always has been",
      "narrates their own actions in the third person when annoyed: 'and so she does it herself, again'",
      "chronically formal -- full names, no contractions, no exceptions, not even for the dog",
      "argues both sides of everything with equal passion and wins as neither",
      "speaks fluent bureaucracy and wields it like a siege weapon at council meetings",
      "answers questions with proverbs that only half fit, delivered with complete confidence",
      "loud, warm, and constitutionally incapable of a private conversation in any building",
      "goes quieter the angrier they get; the whisper is the alarm bell everyone dreads",
      "an accent that thickens exactly when convenient and vanishes under oath",
      "starts every story with 'now this stays between us' at full market-square volume",
      "ends sentences with 'but what do I know,' having just demonstrated they know everything",
      "addresses everyone as 'captain,' 'boss,' or 'young blood' regardless of rank, age, or protest",
      "recites prices, dates, and grievances from decades ago with courtroom precision",
      "talks to animals in a completely different, gentler voice, and will deny it under torture",
      "uses your full name only when you are in trouble, and the town has learned to flinch",
      "pauses so long mid-sentence that people answer, then finishes the sentence over them",
      "speaks of the sea, the mine, or the war in present tense, as if still there",
      "asks 'you follow?' after statements no one could possibly fail to follow",
      "mixes two languages mid-sentence and picks whichever word is more damning",
      "delivers compliments as accusations: 'you WOULD be the clever one, wouldn't you'",
      "never says goodbye -- conversations simply end when they turn and walk away, mid-topic if needed",
      "hums between phrases like the sentence needs a running start",
      "corrects grammar reflexively, even on gravestones, even mid-eulogy, even their own",
      "tells the truth so bluntly it circles around to sounding like comedy",
      "murmurs a running cost estimate of everything in view -- weddings, injuries, other people's coats",
      "answers rhetorical questions earnestly and at length, deaf to groans",
      "voices every side of the argument in different pitches, a one-person parliament",
      "cannot say a number without rounding it dramatically upward, especially fish, crowds, and storms",
      "speaks to children like adults and to adults like children, and both work",
      "quotes books that do not exist with page numbers, and defies you to check",
      "lowers their voice for names of the dead, the rich, and the tax office, equally",
      "says 'in my day' about events from roughly four years ago",
      "issues weather warnings, health advice, and prophecy in the same flat tone, all equally binding",
      "repeats good news twice and bad news once, quickly, like ripping a bandage",
      "prefaces lies with 'hand to my heart,' and truths with nothing, a code everyone eventually cracks",
      "conducts entire conversations in questions, and leaves people unsure what they agreed to",
      "has a public voice and a kitchen voice, and being granted the kitchen voice is the town's true honor",
      "talks over silence like it owes them money -- no pause survives their company",
      "describes everyone by their grandparents: 'you know, the youngest of old Marta's middle boy'",
      "uses nautical, farming, or gambling metaphors for everything, including surgery and romance",
      "sighs the first word of every sentence, as if speech itself were a tax",
      "announces their opinion as 'what people are saying,' when people are saying no such thing",
      "gives directions by buildings that burned down decades ago, and gets offended when you're lost",
      "practices formal speeches for occasions that will never occur, audibly, on walks",
      "calls everyone 'love,' 'friend,' or 'stranger' -- and the sorting is instantaneous and final",
      "ends disputes with 'well, we've all said things,' having said by far the most things",
      "reads aloud everything they write while writing it, including the parts about you",
      "claims to hate gossip in the same breath as delivering the best of it",
      "speaks so slowly that people finish their sentences, wrongly, and get corrected at the same pace",
      "an unexpectedly beautiful singing voice, deployed only when they think the room is empty",
      "swallows the ends of sentences when the subject turns to themselves",
    ],
    nsfw: [
      "a low bedroom register they can switch on mid-sentence, usually in inappropriate venues",
      "compliments that are technically decent and entirely, unmistakably not",
      "double meanings in everything, with the sustained eye contact to confirm each one",
      "discusses their exploits at brunch volume, with names changed unconvincingly",
      "asks shockingly intimate questions with the straight face of a census taker",
      "the vocabulary of a saint until the door closes, then a sailor's education",
      "purrs names instead of saying them, and your own name becomes unfamiliar territory",
      "narrates what they'd do to you as cheerful hypotheticals, smiling, mid-errand",
      "gives voice to a laugh that should require a permit indoors",
      "describes food, weather, and furniture in terms that make listeners blush at dinner tables",
      "issues invitations disguised as observations: 'big storm tonight; my fire's already lit'",
      "answers 'how are you' with a level of detail about last night that no one requested",
      "talks about the body -- theirs, yours, everyone's -- with a surgeon's frankness and a poet's aim",
      "drops into a whisper for exactly the words the whole table most wants to hear",
      "compliments departing guests in ways that keep them awake later",
      "refers to past lovers by number and lets people wonder how high the count goes",
      "pronounces certain innocent words -- 'butter,' 'saddle,' 'harvest' -- in a way that should be illegal",
      "flirts in a second language and translates only the harmless half",
      "asks 'is it warm in here' as a full seduction strategy, with a documented success rate",
      "signs off every conversation with 'you know where to find me,' and everyone does",
    ],
    explicit: [
      "describes ____ in loving, technical detail to anyone who lingers too long at the counter",
      "a filthy nickname for everyone in town -- yours is ____, and it's disturbingly accurate",
      "gives explicit, unsolicited advice about ____ to newlyweds, clergy, and passersby alike",
      "moans theatrically over ordinary pleasures like ____, in public, without shame or warning",
      "recounts last night's ____ like a sports commentator, with replays and statistics",
      "propositions people with the exact phrase '____', every time, and it works often enough",
      "rates every ____ they've ever had aloud, in descending order, when drinking",
      "talks their partners through ____ in a voice the walls have memorized",
      "answers questions about ____ with demonstrations rather than words",
      "has a special voice reserved for ____, and hearing it once is a permanent memory",
      "narrates ____ as it happens, which lovers describe as either unbearable or the entire appeal",
      "whispers '____' as a greeting to the select few who know what it unlocks",
      // Filled-in inspiration -- half the tier stays blank for the writer.
      "narrates exactly what they intend to do to you tonight, at breakfast, over the eggs",
      "praises obedience in a register that makes grown adults straighten their backs",
      "says 'good' when you comply with anything at all, and the word lands somewhere low",
      "issues bedroom commands with a drill sergeant's crisp economy, and expects answers out loud",
      "has a begging voice, deploys it in public negotiations, and wins",
      "recites filthy poetry from memory, attributes it to famous poets, and is lying",
      "describes former lovers' sounds in loving detail, ranked, with impressions",
      "talks partners through the whole act in a low running commentary regulars call the sermon",
      "asks 'colors?' of anyone who looks overwhelmed, in any context, purely from habit",
      "moaned their own name once, by one account, which somehow makes everything worse",
    ],
  },

  want: {
    normal: [
      "wants to be taken seriously, just once, by anyone, and has a speech prepared for the occasion",
      "wants to know everyone's business -- not to use it, purely for the completeness of the collection",
      "wants the shop to outlive them, and fears the children will sell it before the funeral meats are cold",
      "wants an apology they will never ask for out loud, from someone who has forgotten the offense",
      "wants to leave this town, has packed twice, and unpacked twice, and knows exactly why",
      "wants to matter to the hero the way the hero matters to them, and settles for being useful",
      "wants their child to call more often, and mentions it only sideways, in every conversation",
      "wants the old days back, and has edited the old days heavily to be worth wanting",
      "wants to win the annual contest that nobody else takes seriously, and trains for it in secret",
      "wants to be asked about the war, the tour, the glory days -- and nobody ever, ever asks",
      "wants a quiet life, and keeps volunteering for chaos with the reliability of the tide",
      "wants to finally beat their rival at something that counts, having beaten them at everything that doesn't",
      "wants forgiveness for a thing no one else remembers, and can't accept that forgetting counts",
      "wants someone to inherit the secret before it dies with them, and keeps failing the candidates",
      "wants proof they made the right choice thirty years ago, and collects evidence daily",
      "wants the road repaired, has wanted it for a decade, and has made it their entire political identity",
      "wants to see the ocean, the capital, or the mountain once before the end, and keeps finding reasons not to go",
      "wants their name on something permanent -- a bench, a bridge, a bylaw -- anything that outlasts weather",
      "wants to be needed more than loved, and engineers small emergencies to arrange it",
      "wants the recipe, technique, or trick their mother took to the grave, and is reverse-engineering it by trial",
      "wants one more conversation with the one who left, and rehearses it against strangers",
      "wants the debt repaid not for the money but for the acknowledgment it would carry",
      "wants to catch the thing that has raided the garden for years; it has become theology",
      "wants their sibling to admit what really happened that winter, and will outlive them to hear it",
      "wants to retire, announces it seasonally, and would die within a month of actually doing it",
      "wants a rival, honestly -- someone worth sharpening against -- and finds everyone disappointingly agreeable",
      "wants the house to be full again, one loud dinner, every chair taken, just once more",
      "wants to be underestimated, works hard at it, and files away every smirk for later",
      "wants to confess something small that has calcified into something enormous through the waiting",
      "wants the town to need saving so they can be the one who saw it coming",
      "wants their handwriting, pie, or knots to be the standard others are measured by, and quietly already keeps the rankings",
      "wants to know if the letter ever arrived; it has been forty years and the question still eats",
      "wants a title -- deputy, warden, keeper of anything -- the word matters more than the work",
      "wants the young ones to stay, and makes staying so complicated that they leave sooner",
      "wants to be surprised, just once, by anything, and has correctly predicted every event since the flood",
      "wants their garden, boat, or workshop to be seen by the one person whose opinion ever counted",
      "wants back the exact object they traded away young and foolish, and tracks its owners like a detective",
      "wants a storm big enough to justify the preparations they've made for one",
      "wants to be believed about what they saw that night, and has stopped telling it, which is worse",
      "wants the choir, team, or guild to take them back, and pride has barred the door from the inside",
      "wants to finish the argument their late spouse won, and keeps drafting the rebuttal",
      "wants to have been the one who found the child, stopped the fire, or caught the horse -- wants it retroactively, bitterly",
      "wants their fear of deep water, high places, or crowds to stay secret in a town built on all three",
      "wants an heir for the feud; the hatred is an heirloom and the neighbors' children show no promise",
      "wants to read the letters in the locked drawer and wants never to have found them, equally",
      "wants the festival to go perfectly this year, because last year is why the committee meets in secret now",
      "wants to know which of the children is theirs -- the midwife knew, and the midwife is gone",
      "wants the courage to sell everything, and prices it all annually in a notebook kept for the purpose",
      "wants to be wrong about the thing they are so visibly, provably right about",
      "wants their small daily kindness to stay anonymous, and is running out of ways to deny it",
      "wants the bell, mill, or lighthouse working again, and has adopted its silence as a personal insult",
      "wants one photograph, painting, or song to exist of them young, and pretends not to care that none does",
      "wants permission to grieve something the town agreed was good riddance",
      "wants to teach someone the dying craft, and scares off every apprentice by caring too loudly",
      "wants to win an argument with the priest, doctor, or schoolmaster in public, and loses on purpose in private",
      "wants to see the rival family's fence moved back the historic three feet, and has the documents",
    ],
    nsfw: [
      "wants someone to take them on a real date first and then ravish them properly after, in that order, non-negotiable",
      "wants to be desired again, and runs small tests on everyone to check the reading",
      "wants one reckless night that no one back home could ever, ever hear about",
      "wants the person they can't have, and orbits them with the discipline of a moon",
      "wants to be pursued -- the chase is the point, surrender is the trophy they intend to award slowly",
      "wants an arrangement: no names, no mornings, no feelings, and is failing at exactly one of the three",
      "wants to corrupt someone respectable, slowly, and has already selected the candidate",
      "wants to be someone's dangerous secret -- the hiding is the entire thrill",
      "wants their wedding-night confidence back, and practices in the mirror like a speech",
      "wants to be undressed by someone patient, having spent years with the impatient kind",
      "wants a lover who argues first -- the fight is the courtship and always has been",
      "wants to be written about, filthily and anonymously, and to watch the town guess wrong",
      "wants the innkeeper, blacksmith, or captain to finally act on ten years of looks",
      "wants a rival in love worth losing to, or better, worth beating publicly",
      "wants to seduce and be seduced on the same night and keep score of who moved first",
      "wants their body worshiped once without a single word of conversation",
      "wants the letter they never sent to have been received exactly as intended, sighs included",
      "wants a summer like the one before they married, and knows precisely which summer",
      "wants to say yes to the standing offer everyone assumes they refused years ago",
      "wants to be the reason someone respectable is late, disheveled, and lying badly about it",
    ],
    explicit: [
      "secretly wants to be ____ and would sooner die than say it aloud, which is why it leaks out everywhere",
      "wants to be ____ by ____, and has planned the logistics in detail down to the excuse",
      "wants to try ____ at least once before they're too old to enjoy it properly",
      "wants a partner who will finally ____ without needing to be asked, begged, or diagrammed",
      "wants to be caught doing ____ -- the risk is the point, the audience is the fantasy",
      "wants to serve as somebody's ____, devotedly, on whatever terms are offered",
      "wants a ____ of their very own -- trained, devoted, and worth the scandal",
      "wants to confess their taste for ____ to someone who will neither flinch nor tell",
      "wants to trade ____ for ____ with the one person in town who'd understand the exchange rate",
      "wants an entire weekend of ____, provisions laid in, door barred, questions refused",
      "wants to be introduced to ____ by someone experienced, patient, and sworn to secrecy",
      "wants ____ exactly the way it happens in the books they hide, not the way it happened before",
      // Filled-in inspiration -- half the tier stays blank for the writer.
      "wants to be tied, properly, by someone who learned knots at sea and patience somewhere worse",
      "wants to spend one full day collared, waited on, and utterly without decisions to make",
      "wants to be shared between two people who love each other and argue over them politely",
      "wants to be taken against the workbench mid-argument, and has started picking arguments accordingly",
      "wants an audience exactly once -- masked, anonymous, and never spoken of again",
      "wants to train a devoted plaything of their own, and has been auditioning without telling anyone",
      "wants to be denied slowly and expertly until asking becomes begging -- and then wants to win",
      "wants a lover who marks what is theirs, and a town that never asks about the marks",
      "wants their respectable spouse to finally find the diary, and leaves it less hidden every month",
      "wants to kneel for exactly one person alive, and that person keeps failing to notice",
    ],
  },

  // Declared below as a hoisted function purely to keep this file readable
  // -- the hidden pool is the newest and largest block of commentary.
  hidden: hiddenPool(),
};

// hidden -- secrets, tells, and planted details for the Hidden and
// Foreshadowing section. Written as things the READER can feel before they
// are told: a behavior with a buried cause, a detail that pays off later.
// (In the profile system these stay writer-side context; the AI expresses
// hidden traits only as subtext, never by naming them.)
function hiddenPool(): TraitPool {
  return {
  normal: [
    "keeps a packed bag under the bed and rotates the food in it monthly, ready for a day they never name",
    "is sending money somewhere every month, in cash, through a third party who thinks it's for a charity",
    "was in the town the night of the famous fire, and their alibi has one hole nobody has ever poked",
    "can read people's lips across a room and has learned far more than anyone suspects",
    "wears a ring on a chain under their shirt that matches no marriage anyone remembers",
    "goes pale at the smell of a specific flower and leaves any room it enters",
    "knows exactly where the old tunnel, cellar, or crawlspace comes out, and checks the entrance monthly",
    "answers to a second name when startled, then laughs it off a beat too late",
    "keeps every letter they've ever received except one year -- that year is missing entirely",
    "is quietly fluent in a language they claim not to speak, and listens hardest when it's spoken",
    "never eats in front of other people, ever, and has an airtight excuse each time",
    "has a standing appointment every month they will reschedule funerals to keep",
    "flinches at the sound of their own surname said formally, as if it belongs to someone else",
    "owns a weapon far too fine for their station, oiled and wrapped at the bottom of a chest",
    "knows the villain's face -- knew it before the story started -- and has said nothing",
    "practices signing a name that isn't theirs, late, by lamplight",
    "planted a tree, stone, or post at the edge of the property that marks something no map shows",
    "keeps the newspaper clipping of an accident they were never officially part of",
    "was once the best in the county at the exact skill the plot will eventually demand",
    "counts exits and strangers' hands by reflex, in that order, everywhere",
    "pays for a room in another town that no one has ever seen them use",
    "carries a child's toy, sock, or drawing in an inside pocket and touches it before hard decisions",
    "never turns their back on the water, the woods, or the mine -- pick one, it's specific",
    "has a scar that predates every story they tell about it",
    "asks one strange question of every traveler -- always the same question -- and files the answers",
    "keeps two sets of accounts, and the honest set is the hidden one",
    "was disinherited by a family whose name would stop conversation in this town",
    "recognizes the melody the stranger hums, and leaves before the second verse",
    "tends a grave with no name on it, out past the fence line, on the same day each year",
    "hoards medicine, thread, and salt in quantities that suggest they've survived a siege before",
    "will not swear any oath, not even trivial ones, and deflects with jokes that aren't jokes",
    "the dog, the horse, or the cat -- animals that hate everyone -- are calm around them, oddly calm",
    "knows how to open locks, set bones, or forge seals, and claims a harmless hobby explains it",
    "gets a letter every season, reads it by the fire, burns it, and is cheerful for exactly two days",
    "wears gloves for one task no one else would think needs gloves",
    "has already forgiven the person the town still hates, for reasons they've never shared",
    "keeps the shop's back room locked and has repainted the lock's scratches twice",
    "startles awake at the same hour every night, checks the same window, and never explains",
    "once said a name in fever sleep that made the doctor go quiet and leave early",
    "knows the marsh, ridge, or ruins better than someone who claims to have never gone",
    "tips sailors, drifters, and messengers generously, always with a question folded into the coin",
    "has a twin, a double, or a sibling the family photos have been carefully edited around",
    "never celebrates their own birthday but marks a different date no one can place",
    "learned to fight somewhere that teaches finishing, not sparring, and hides it badly when startled",
    "keeps a promise to someone dead, and the promise is starting to cost more than they can pay",
    "is the only one in town the old hermit, witch, or recluse will speak to",
    "carries poison, a confession, or a deed -- something in that locket -- and checks the clasp hourly",
    "has rehearsed a confession so many times it now sounds like a story about someone else",
    "watched the bridge, barn, or boat burn and did not raise the alarm, and knows why",
    "answers the door armed after dark, casually, as if everyone does",
    "their oldest friendship is actually a debt neither of them has ever named aloud",
  ],
  nsfw: [
    "is having the affair everyone jokes about, with the one person nobody has guessed",
    "has a past life in a profession that would scandalize the parish, and one client who remembers",
    "keeps a locked drawer of letters that would end three marriages, none of them their own",
    "wears something under their clothes, every day, that belongs to someone they shouldn't miss",
    "has a standing midnight arrangement everyone attributes to insomnia",
    "was the anonymous author of the scandalous pamphlet, poem, or letters everyone still quotes",
    "knows a birthmark, scar, or tattoo they could only know one way, on someone very respectable",
    "left the capital, port, or court one step ahead of a scandal that had a title attached to it",
    "keeps the key to a room in the inn that officially doesn't rent",
    "is being quietly paid for discretion about a night involving someone now very important",
    "has a signal -- a lamp, a flowerpot, a drawn curtain -- and someone answers it",
    "the pilgrimage they take every spring is not a pilgrimage",
    "taught the town's most respectable person everything that person pretends not to know",
    "keeps a portrait, miniature, or photograph that must be turned face-down when certain guests call",
    "their famous feud with the neighbor began in a bed, not over the fence line",
    "collects the courting letters of half the town -- written FOR the senders, in their hand, for a fee",
    "has been married before, somewhere with different laws, to someone who may not agree it ended",
    "knows exactly which respectable house has a hidden door, and has used it",
    "once modeled for the painting, statue, or illustration that hangs where everyone can see it",
    "their vow of celibacy, mourning, or propriety has one standing exception with its own schedule",
  ],
  explicit: [
    "secretly does ____ on the nights everyone assumes they're at prayer, cards, or the lodge",
    "keeps the ____ from a past lover locked in ____, and takes it out when it storms",
    "is known, in a city far from here, by the working name ____",
    "will do anything asked of them by ____ because of what happened involving ____",
    "has a hidden ____ dedicated entirely to ____, and one person alive has seen it",
    "was trained in ____ by ____, and the skill leaks out at the worst possible moments",
    "trades ____ for silence with ____, and the price has been rising",
    "wrote the anonymous ____ describing ____, and the descriptions were from memory",
    "keeps a coded diary of every ____, and the code is starting to be too clever for them",
    "their scar, limp, or burn came from ____ during ____, not the story everyone was told",
    "answers to ____ behind one particular locked door, and to nothing else there",
    "the person they mourn publicly as ____ was actually their ____",
    // Filled-in inspiration -- half the tier stays blank for the writer.
    "spends the quarterly 'audit trip' at a discreet club where they are known only as a number",
    "was a professional dominant in the capital, and one devoted client's letters still arrive",
    "keeps a locked chest of implements under the marriage bed the spouse believes holds linens",
    "obeys one person in this town absolutely, by standing arrangement, and no one would guess which",
    "poses nude for the artist two villages over, trading silence for the canvases, which they burn",
    "trained that famous composure under a strict lover's discipline, and misses it more than the lover",
    "has a safeword older than their marriage and has never once used it",
    "runs the anonymous letterbox where the town's proper folk confess their appetites, and answers each in a disguised hand",
    "keeps the key to their own chastity on a chain at their throat, and gave the only copy away years ago",
    "services the manor's master and mistress both, on alternating evenings, with the staff sworn quiet",
  ],
  };
}

// ── Archetype flavor -- role-weighted extras for the NORMAL tier ─────────────
// Keyed by SpineOption.id from characterSpines.ts ARCHETYPE_OPTIONS. These
// get shuffled to the FRONT of the normal pool when that role is selected.

export const ARCHETYPE_FLAVOR: Partial<Record<string, Partial<Record<TraitSection, string[]>>>> = {
  comic_relief: {
    mannerism: [
      "enters every scene one beat after the perfect setup line, as if summoned by it",
      "mimes along behind authority figures with uncanny, career-endangering accuracy",
    ],
    voice: [
      "quips that land hardest when everything is falling apart -- the darker the night, the better the timing",
      "puns so committed and so terrible that the groan has become the town's applause",
    ],
    want: ["wants one real laugh from the person who never laughs, and is playing the long game to get it"],
  },
  mentor: {
    mannerism: ["answers questions by handing you a task instead, and the task turns out to be the answer"],
    voice: ["parables first, instructions only if you fail the parable twice"],
    want: ["wants the student to surpass them, and quietly dreads the actual day it happens"],
  },
  caregiver: {
    mannerism: ["feeds everyone within reach; refusing a plate is treated as a formal declaration of war"],
    want: ["wants one person to notice they are running on empty before the tank actually reads it"],
  },
  rival: {
    mannerism: ["keeps score out loud, in everything, including things that are demonstrably not competitions"],
    want: ["wants to finally beat their rival at something that counts, having beaten them at everything that doesn't"],
  },
  shadow: {
    voice: ["reasonable, patient, and always exactly three sentences away from a threat"],
    want: ["wants the hero to admit they were right about one thing, and would trade the victory for the admission"],
    hidden: ["already knows the hero's secret and is saving it for the moment it buys the most"],
  },
  ruler: {
    mannerism: ["rearranges any table they sit at to face the door, including other people's tables"],
    want: ["wants a successor and trusts no candidate, including -- especially -- family"],
  },
  confidant: {
    mannerism: ["pours the drink before the confession starts, having read the walk-in correctly again"],
    want: ["wants to unburden the one secret they were never meant to be given"],
    hidden: ["keeps one confession in writing, sealed, addressed, and unsent -- insurance or mercy, even they aren't sure"],
  },
};

// ── Rolling helper -- pure and injectable for tests ─────────────────────────

/**
 * Roll `count` visible options for a section.
 *
 * Tier selection implements the NSFW toggle semantics exactly (replace, not
 * mix): explicit > nsfw > normal. Archetype flavor applies to the normal
 * tier only. `rng` is injectable (defaults to Math.random) so tests can pin
 * the shuffle.
 *
 * `exclude` = options already shown this cycle. The deal draws only from
 * what's left, so rerolling pages through the WHOLE pool before anything
 * repeats; when the remainder is too small to fill the hand, the cycle
 * resets and the full pool is back in play. The caller tracks the set (see
 * QuickBuildPanel) -- this function stays pure.
 */
export function rollTraitOptions(
  section: TraitSection,
  count: number,
  opts: {
    nsfw?: boolean;
    explicit?: boolean;
    archetypeId?: string | null;
    exclude?: Set<string>;
  } = {},
  rng: () => number = Math.random,
): string[] {
  const pool = TRAIT_POOLS[section];
  let source: string[];
  if (opts.nsfw && opts.explicit) source = pool.explicit;
  else if (opts.nsfw)             source = pool.nsfw;
  else                            source = pool.normal;

  // No-repeat dealing: drop what's been shown, unless that would leave too
  // little to deal -- then the pool has cycled and everything is fresh again.
  const exclude = opts.exclude;
  if (exclude && exclude.size > 0) {
    const remaining = source.filter(o => !exclude.has(o));
    if (remaining.length >= count) source = remaining;
  }

  const shuffle = (arr: string[]) => {
    // Fisher-Yates on a copy -- unbiased, never mutates the pool.
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  if (!opts.nsfw && opts.archetypeId) {
    const flavorAll = ARCHETYPE_FLAVOR[opts.archetypeId]?.[section] ?? [];
    const flavor = exclude ? flavorAll.filter(o => !exclude.has(o)) : flavorAll;
    if (flavor.length > 0) {
      // Flavored options first (up to half the slots), general pool fills
      // the rest -- coherence without making every roll identical.
      const flavorPicks = shuffle(flavor).slice(0, Math.max(1, Math.floor(count / 2)));
      const rest = shuffle(source.filter(o => !flavorPicks.includes(o)))
        .slice(0, count - flavorPicks.length);
      return [...flavorPicks, ...rest];
    }
  }

  return shuffle(source).slice(0, count);
}
