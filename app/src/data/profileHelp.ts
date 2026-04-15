// data/profileHelp.ts -- Help Content for Profile Builder
// =========================================================
// All the contextual help text shown by the (?) icons in the Profile Builder.
// Kept in its own file because there's a LOT of content here -- mixing it
// into ProfileBuilder.tsx would make that file even harder to navigate.
//
// Two kinds of help:
//   1. Importance Level Help -- explains what each level does, with different
//      examples per trait section (Physical, Personality, etc.)
//   2. Section Help -- explains what to write in each text section (Overview,
//      Notes, etc.) with Poor / Good / Great example tiers
//
// The examples use a fictional fantasy character "Kael" and a sci-fi character
// "Dr. Vasquez" so writers can see the pattern, not just the rule.


// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTANCE LEVEL HELP
// ═══════════════════════════════════════════════════════════════════════════════
// Each level has a short summary (shown at top), a detail paragraph, and
// per-section examples so the writer sees how importance works differently
// for Physical Traits vs Personality vs Voice, etc.

export interface ImportanceLevelHelp {
  summary: string;
  detail: string;
  // Examples keyed by section key (e.g. "physical_traits", "personality_traits")
  examples: Record<string, string>;
}

export const IMPORTANCE_HELP: Record<string, ImportanceLevelHelp> = {

  core: {
    summary: "Defining. Always sent to AI. Shapes every scene this character appears in.",
    detail:
      "Core traits are the foundation of who this character is. When the AI writes " +
      "or reviews a scene with this character, Core traits are always present in its " +
      "context. Use this sparingly -- if everything is Core, nothing stands out. " +
      "Ask yourself: 'If the AI forgot this trait, would the character feel wrong?'",
    examples: {
      physical_traits:
        "A visible, always-relevant feature.\n" +
        "Example: 'Tall and broad-shouldered with dark skin and close-cropped silver hair' " +
        "-- this shapes how others react to Kael in every scene.",
      personality_traits:
        "A personality trait that drives most of their decisions.\n" +
        "Example: 'Fiercely protective of anyone she considers family, sometimes to a fault' " +
        "-- this comes up in nearly every interaction.",
      motivations:
        "The central drive behind everything they do.\n" +
        "Example: 'Will do anything to find a cure for her sister's curse' " +
        "-- this is the engine of the story.",
      voice_notes:
        "Their default way of speaking that should appear in most dialogue.\n" +
        "Example: 'Speaks in short, direct sentences. Avoids emotional language.' " +
        "-- this defines how the AI writes their lines.",
      hidden_and_foreshadowing:
        "Rarely appropriate as Core. Hidden traits are meant to be subtle or secret. " +
        "Consider Present or Background instead.",
    },
  },

  present: {
    summary: "Regular. Included when this character is in the scene. Shows up often but not always.",
    detail:
      "Present traits are noticeable and come up regularly, but they don't define " +
      "every single interaction. The AI includes them when this character is active " +
      "in a scene. Most traits should probably land here -- it's the healthy default " +
      "for anything that matters but isn't the character's core identity.",
    examples: {
      physical_traits:
        "Features that are noticeable but not the first thing people see.\n" +
        "Example: 'Walks with a slight limp from an old knee injury' " +
        "-- visible in most scenes, especially action.",
      personality_traits:
        "Traits that surface regularly in interactions.\n" +
        "Example: 'Impatient with authority figures but patient with children' " +
        "-- shows up in relevant scenes, not every line.",
      motivations:
        "Active goals that drive current story threads.\n" +
        "Example: 'Wants to earn back the trust of his former partner' " +
        "-- an ongoing motivation, not the central one.",
      voice_notes:
        "Speech patterns that appear often but not in every line.\n" +
        "Example: 'Uses dark humor when under stress' " +
        "-- situational but frequent.",
      hidden_and_foreshadowing:
        "Foreshadowing that should subtly appear in scenes.\n" +
        "Example: 'Has recurring nightmares about drowning (foreshadows the flood in Act III)' " +
        "-- the AI weaves this in when natural.",
    },
  },

  background: {
    summary: "Supporting. Included only when directly relevant. Adds depth without dominating.",
    detail:
      "Background traits are established canon -- the AI knows about them -- but " +
      "they only surface when the scene makes them relevant. A childhood scar, " +
      "a past hobby, a rarely-used skill. These add texture and depth when they " +
      "naturally fit, without cluttering every scene.",
    examples: {
      physical_traits:
        "Details visible only in specific situations.\n" +
        "Example: 'Has a faded tattoo of a compass on her inner wrist' " +
        "-- only relevant when her sleeves are rolled up or in intimate scenes.",
      personality_traits:
        "Traits that shaped who they are but rarely surface directly.\n" +
        "Example: 'Studied classical music for a decade before enlisting' " +
        "-- colors her worldview but rarely comes up in dialogue.",
      motivations:
        "Past or secondary goals that echo in the background.\n" +
        "Example: 'Once wanted to be a healer, abandoned that path after the war' " +
        "-- explains occasional compassion, not an active pursuit.",
      voice_notes:
        "Rare speech patterns that appear in specific emotional states.\n" +
        "Example: 'Slips into her mother's dialect when very tired or emotional' " +
        "-- once or twice per arc, not every scene.",
      hidden_and_foreshadowing:
        "Subtle seeds the reader shouldn't consciously notice yet.\n" +
        "Example: 'Avoids touching iron -- never explained why (readers learn in Book 2)' " +
        "-- tiny behavioral detail, not highlighted.",
    },
  },

  contextual: {
    summary: "Situational. Only included when the writer explicitly attaches this profile.",
    detail:
      "Contextual traits are real and canon, but they're so specific that the AI " +
      "only needs them in certain scenes. A rare allergy, a niche skill, a subplot " +
      "detail. The writer decides when to attach this profile, and only then does " +
      "the AI see these traits. Good for keeping AI context lean.",
    examples: {
      physical_traits:
        "Niche physical details relevant only in specific plot moments.\n" +
        "Example: 'Severely allergic to thornberries -- causes throat swelling within minutes' " +
        "-- only matters in the poisoning subplot.",
      personality_traits:
        "Narrow skills or knowledge that apply to specific scenarios.\n" +
        "Example: 'Knows how to pick locks -- learned from her uncle as a teenager' " +
        "-- only relevant in heist or escape scenes.",
      motivations:
        "Subplot threads the writer may or may not activate.\n" +
        "Example: 'Curious about her birth parents but hasn't acted on it yet' " +
        "-- a thread the writer can pull when ready.",
      voice_notes:
        "Niche speech abilities used in very specific scenes.\n" +
        "Example: 'Can perfectly mimic her commanding officer's voice' " +
        "-- a party trick or deception tool, not a character voice.",
      hidden_and_foreshadowing:
        "Plot hooks the writer hasn't decided to activate yet.\n" +
        "Example: 'May or may not be immune to the plague -- writer undecided' " +
        "-- stored for reference, not sent unless explicitly attached.",
    },
  },

  hidden: {
    summary: "Writer-only. Never sent to AI. Private notes and spoilers.",
    detail:
      "Hidden traits are for the writer's eyes only. The AI never sees them, " +
      "so they won't influence any generated text. Use this for plot spoilers, " +
      "future twists, private brainstorming, or meta-notes about the character " +
      "that would ruin the story if the AI revealed them too early.",
    examples: {
      physical_traits:
        "Future physical changes the AI shouldn't know about yet.\n" +
        "Example: 'Will lose her left hand in the Battle of Ashenmere (Chapter 18)' " +
        "-- AI must not foreshadow this.",
      personality_traits:
        "Secret identities or unrevealed truths.\n" +
        "Example: 'Is actually the traitor who sold the city's defenses' " +
        "-- if the AI knew, it might write suspicious behavior too early.",
      motivations:
        "Endgame plans the reader shouldn't suspect.\n" +
        "Example: 'Plans to betray the group and take the artifact for herself' " +
        "-- must stay hidden until the reveal chapter.",
      voice_notes:
        "Future voice changes driven by plot events.\n" +
        "Example: 'After the trauma in Act III, develops a halting stutter' " +
        "-- the AI shouldn't write the stutter before it happens.",
      hidden_and_foreshadowing:
        "Deep spoilers and writer-only planning notes.\n" +
        "Example: 'Is the prophesied Ember King. Reveal planned for final chapter.' " +
        "-- the ultimate Hidden trait.",
    },
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// TEXT SECTION HELP
// ═══════════════════════════════════════════════════════════════════════════════
// For sections that use a plain textarea instead of trait blocks (Overview,
// Relationships Overview, Notes, etc.). Each entry explains what to write
// and shows Poor / Good / Great quality tiers so the writer can see the
// difference between "the AI will struggle with this" and "the AI will
// nail this."
//
// Keyed by "{profileType}_{sectionKey}" so each profile type gets its own
// tailored examples. Falls back to a generic entry if no specific one exists.

export interface SectionHelp {
  whatToPut: string;       // Short explanation of what goes in this field
  poorExample: string;     // Example the AI would struggle with
  poorWhy: string;         // Why it's poor
  goodExample: string;     // Example the AI could work with
  goodWhy: string;         // Why it's good
  greatExample: string;    // Example optimized for AI understanding
  greatWhy: string;        // Why it's great
}

export const SECTION_HELP: Record<string, SectionHelp> = {

  // ── Character Sections ──────────────────────────────────────────────────────

  character_overview: {
    whatToPut:
      "The character's identity in your own words. Who are they as a person? " +
      "What defines them? Focus on personality, emotional patterns, and how they " +
      "relate to the world. This is NOT a plot summary or backstory dump.",
    poorExample:
      "Kael is a warrior who fights in the rebellion. He was born in a small " +
      "village and his parents were killed when he was young. He traveled to " +
      "the capital and joined the resistance. He's good with a sword.",
    poorWhy:
      "This reads like a plot summary. It tells the AI what happened to Kael, " +
      "not who he IS. The AI can't write his reactions, dialogue, or inner " +
      "thoughts from this because it doesn't know his personality.",
    goodExample:
      "Kael is a disciplined, stoic warrior who keeps people at arm's length. " +
      "He's driven by guilt over failing to save his village and channels that " +
      "into an obsessive dedication to the rebellion. He respects competence " +
      "and has little patience for politics.",
    goodWhy:
      "Now the AI knows Kael's emotional patterns (guilt, stoicism), how he " +
      "relates to others (arm's length, respects competence), and what drives " +
      "him. It can write believable reactions.",
    greatExample:
      "Kael carries himself with quiet, coiled intensity. He's the kind of man who " +
      "notices every exit in a room before he notices the people in it. His guilt " +
      "over losing his village has calcified into rigid self-discipline; he treats " +
      "every mission like a debt payment. Underneath the stoicism, he craves " +
      "connection but doesn't trust himself to protect anyone again. He shows " +
      "care through actions (sharpening someone's blade, standing watch an extra " +
      "shift) rather than words.",
    greatWhy:
      "This gives the AI vivid behavioral cues it can use in prose. 'Notices every " +
      "exit' is a concrete action. 'Shows care through actions' tells the AI exactly " +
      "how to write tender moments without breaking character.",
  },

  character_relationships_overview: {
    whatToPut:
      "How this character connects to other key characters. Focus on the emotional " +
      "dynamics, not plot history. What tensions exist? Who do they trust? Who do " +
      "they clash with? Keep this about the relationship FEEL, not a timeline of events.",
    poorExample:
      "Kael met Sera in Chapter 3. They fought together in the Battle of Ashenmere. " +
      "He also knows Commander Dren from the academy.",
    poorWhy:
      "This is a timeline. The AI learns when they met but not how they feel about " +
      "each other. It can't write realistic dialogue or tension between them.",
    goodExample:
      "Kael trusts Sera with his life but struggles to open up to her emotionally. " +
      "He respects Commander Dren but resents being treated like a weapon rather " +
      "than a person.",
    goodWhy:
      "Now the AI knows the emotional dynamics: trust vs emotional distance with " +
      "Sera, respect vs resentment with Dren. It can write tension naturally.",
    greatExample:
      "Sera is the only person who's seen Kael flinch, and he both values and " +
      "fears that vulnerability. He'll defer to her judgment in combat but shuts " +
      "down when she asks about his past. With Commander Dren, it's professional " +
      "respect layered over simmering resentment -- Kael follows orders but makes " +
      "a point of never volunteering.",
    greatWhy:
      "The AI gets specific behavioral cues for each relationship: 'defers in " +
      "combat, shuts down about his past' and 'follows orders but never volunteers.' " +
      "These translate directly into realistic scene behavior.",
  },

  character_notes: {
    whatToPut:
      "Free-form space for anything that doesn't fit elsewhere. Writing reminders, " +
      "unresolved questions, continuity notes, or things to revisit later. " +
      "This section IS sent to AI, so don't put spoilers here (use Hidden traits " +
      "for those).",
    poorExample: "Need to figure out his backstory more.",
    poorWhy: "Too vague. Doesn't help the AI or the writer.",
    goodExample:
      "Reminder: Kael has NOT revealed his village's name to anyone yet. " +
      "His sword hand trembles slightly when he's angry (established in Ch. 4).",
    goodWhy:
      "Concrete continuity notes the AI can respect when writing new scenes.",
    greatExample:
      "Continuity: Kael hasn't told anyone his village's name (reveal planned for " +
      "the campfire scene in Act II). His sword hand trembles when angry (Ch. 4). " +
      "He always eats last in group meals (established habit, not explicitly discussed). " +
      "Avoid: having him initiate physical affection -- he freezes when touched " +
      "unexpectedly.",
    greatWhy:
      "Specific behavioral dos and don'ts the AI can follow. The 'Avoid' note " +
      "prevents the AI from writing out-of-character moments.",
  },

  // ── Relationship Sections ───────────────────────────────────────────────────

  relationship_overview: {
    whatToPut:
      "The core dynamic between these two characters. What's the emotional temperature? " +
      "What does each person need from the other? Where is the tension?",
    poorExample: "They are best friends who went to school together.",
    poorWhy:
      "Tells the AI a fact but nothing about the emotional texture. " +
      "The AI can't write interesting dialogue from 'they're friends.'",
    goodExample:
      "A deep friendship built on mutual respect, but strained by unspoken jealousy. " +
      "Kael admires Sera's ease with people; Sera envies Kael's certainty of purpose.",
    goodWhy:
      "The AI now has the emotional undercurrent: admiration + jealousy on both sides.",
    greatExample:
      "They'd die for each other without hesitation, but they can't talk about feelings " +
      "without one of them deflecting with humor. Kael admires how effortlessly Sera " +
      "connects with people (something he can't do), while Sera envies Kael's single-minded " +
      "clarity (she second-guesses everything). Their arguments tend to start about tactics " +
      "and end up being about something neither will name.",
    greatWhy:
      "The AI gets specific interaction patterns: 'deflecting with humor,' 'arguments " +
      "about tactics that are really about something else.' These are scenes waiting to happen.",
  },

  relationship_history: {
    whatToPut:
      "Key moments that shaped the relationship. Focus on turning points and emotional " +
      "landmarks, not a complete timeline.",
    poorExample: "They met 5 years ago and have been friends since.",
    poorWhy: "No emotional content for the AI to work with.",
    goodExample:
      "Bonded during a two-week survival march after their unit was ambushed. " +
      "Sera carried Kael for the last three miles after his leg gave out.",
    goodWhy: "A concrete shared experience that explains the depth of their bond.",
    greatExample:
      "The survival march forged them: two weeks of desperation stripped away every " +
      "pretense. Sera saw Kael cry exactly once (when his leg broke) and never " +
      "mentioned it again. That unspoken pact -- I saw you at your worst and I'll " +
      "never use it -- is the foundation of their trust.",
    greatWhy:
      "The AI understands not just what happened but what it MEANS to both characters. " +
      "'Never mentioned it again' is a behavioral rule the AI can follow.",
  },

  relationship_current_dynamic: {
    whatToPut:
      "How the relationship works right now in the story. What's the day-to-day " +
      "emotional texture? Are they growing closer or drifting apart?",
    poorExample: "They work well together.",
    poorWhy: "No texture. The AI writes generic friendly interactions.",
    goodExample:
      "Currently tense. Kael's obsession with the mission is pushing Sera away, " +
      "and neither knows how to address it.",
    goodWhy: "Clear emotional direction the AI can reflect in scenes.",
    greatExample:
      "Outwardly solid: they still fight in perfect sync, finish each other's tactical " +
      "sentences, cover each other without thinking. But Sera has started withholding " +
      "her doubts about the mission instead of voicing them, and Kael hasn't noticed. " +
      "The cracks are invisible to everyone except maybe Commander Dren.",
    greatWhy:
      "The AI gets the public face AND the private truth. It can write scenes where " +
      "they seem fine on the surface while building subtle tension underneath.",
  },

  relationship_hidden_tensions: {
    whatToPut:
      "Unspoken conflicts, secrets, or emotional undercurrents that neither character " +
      "has addressed. Things that could explode later.",
    poorExample: "There might be some tension eventually.",
    poorWhy: "Too vague. The AI ignores this entirely.",
    goodExample:
      "Sera suspects Kael would sacrifice the team to complete the mission. " +
      "She hasn't confronted him because she's afraid the answer is yes.",
    goodWhy: "A specific suspicion with a specific reason for silence.",
    greatExample:
      "Sera suspects Kael would sacrifice the team to complete the mission, and " +
      "she's afraid to ask because if the answer is yes, she'd have to choose between " +
      "loyalty to him and loyalty to the group. Kael, meanwhile, senses Sera pulling " +
      "back but attributes it to combat fatigue rather than distrust.",
    greatWhy:
      "Both sides of the tension are mapped. The AI can write Kael misreading " +
      "Sera's distance, which builds dramatic irony the reader can feel.",
  },

  relationship_emotional_direction: {
    whatToPut:
      "Where is this relationship headed? What arc are you building toward? " +
      "This helps the AI write scenes that move the relationship in the right direction.",
    poorExample: "They'll work it out eventually.",
    poorWhy: "No direction for the AI to build toward.",
    goodExample:
      "Building toward a confrontation where Sera forces Kael to choose: " +
      "the mission or the people.",
    goodWhy: "Clear destination. The AI can write scenes that build toward this.",
    greatExample:
      "Heading toward a breaking point. Small betrayals of trust (Kael making " +
      "unilateral decisions, Sera keeping her doubts private) are accumulating. " +
      "The confrontation should feel inevitable but not scripted -- it erupts from " +
      "a small moment, not a dramatic speech. After the break, they slowly rebuild " +
      "but on more honest terms.",
    greatWhy:
      "The AI knows the trajectory AND the tone: 'erupts from a small moment, " +
      "not a dramatic speech.' That's a specific writing instruction.",
  },

  relationship_notes: {
    whatToPut:
      "Continuity reminders, unresolved threads, or writing notes about this relationship.",
    poorExample: "They're important to each other.",
    poorWhy: "Already obvious from the other sections.",
    goodExample:
      "Reminder: Sera doesn't know about Kael's village yet. Their inside joke " +
      "about 'the compass problem' started in Ch. 2.",
    goodWhy: "Concrete continuity details the AI can track.",
    greatExample:
      "Continuity: Sera hasn't learned Kael's real name (using alias since Ch. 1). " +
      "Their sparring sessions are their version of emotional intimacy (established " +
      "Ch. 3). Avoid: having them express affection verbally -- they show it through " +
      "actions (covering fire, saving food, standing watch).",
    greatWhy:
      "Behavioral rules ('Avoid verbal affection') and established patterns " +
      "('sparring = intimacy') that keep scenes consistent.",
  },

  // ── Location Sections ───────────────────────────────────────────────────────

  location_overview: {
    whatToPut:
      "What this place IS and what it FEELS like. The emotional impression, " +
      "not an architectural blueprint.",
    poorExample: "A large city with walls and a market.",
    poorWhy: "Generic. Could be any city in any fantasy novel.",
    goodExample:
      "A walled port city built on volcanic rock. Wealthy on the surface but " +
      "rotting from corruption underneath. The salt air mixes with incense smoke.",
    goodWhy: "Sensory details and emotional tone the AI can use in prose.",
    greatExample:
      "Ashenmere clings to a volcanic shelf like a barnacle. The upper tiers gleam with " +
      "imported marble and temple spires; the lower docks smell of brine and desperation. " +
      "It's a city that rewards ambition and punishes honesty, and everyone who lives " +
      "there knows it. Newcomers feel the tension before anyone explains the politics.",
    greatWhy:
      "The AI gets a FEEL, not just a description. 'Rewards ambition, punishes " +
      "honesty' tells it how characters behave here. 'Newcomers feel the tension' " +
      "gives it an emotional entry point for any scene set here.",
  },

  location_physical_description: {
    whatToPut:
      "The physical layout and key landmarks. What does a character SEE, HEAR, " +
      "and SMELL when they arrive? Focus on sensory details over measurements.",
    poorExample: "The castle is big with many rooms.",
    poorWhy: "No sensory detail. The AI writes flat, generic descriptions.",
    goodExample:
      "A sprawling fortress of dark stone overlooking the harbor. The main " +
      "hall has a cracked mosaic floor and windows too narrow for an adult to climb through.",
    goodWhy: "Specific visual details the AI can reference in scenes.",
    greatExample:
      "Dark basalt walls that absorb sound -- footsteps echo wrong here, " +
      "arriving before you expect them. The main hall's mosaic floor tells " +
      "the city's founding myth in cracked tiles (half the figures are missing " +
      "their faces, worn smooth by centuries of boots). Arrow-slit windows " +
      "let in columns of salt-air light that never quite reach the center of any room.",
    greatWhy:
      "Multi-sensory ('absorb sound,' 'salt-air light') with mood built in. " +
      "The AI writes richer, more atmospheric scenes from this.",
  },

  location_tone_and_atmosphere: {
    whatToPut:
      "The emotional atmosphere. How do people feel here? Is it oppressive, " +
      "welcoming, eerie, chaotic? What's the ambient sound?",
    poorExample: "It's a scary place.",
    poorWhy: "The AI doesn't know what KIND of scary. Haunted? Dangerous? Unsettling?",
    goodExample:
      "Oppressive and watchful. Guards on every corner. People speak in low " +
      "voices even in their own homes.",
    goodWhy: "Behavioral details that show atmosphere through actions.",
    greatExample:
      "The kind of place where laughter sounds wrong. Guards patrol in pairs, " +
      "and civilians make a point of not making eye contact with them. " +
      "Conversations die when strangers approach. The only place that feels " +
      "alive is the night market, where the anonymity of crowds lets people " +
      "breathe for a few hours.",
    greatWhy:
      "The AI can write crowd behavior, character reactions, and scene tension " +
      "from these specific social cues.",
  },

  location_historical_significance: {
    whatToPut:
      "Key historical events tied to this place. Focus on what characters " +
      "KNOW and FEEL about the history, not a textbook timeline.",
    poorExample: "The city was founded 500 years ago by King Aldric.",
    poorWhy: "A fact with no emotional weight.",
    goodExample:
      "Built on the ruins of a civilization that vanished overnight. " +
      "The locals don't talk about it, but superstitions about the old " +
      "tunnels beneath the city persist.",
    goodWhy: "Mystery + cultural behavior the AI can reference in dialogue.",
    greatExample:
      "Everyone in Ashenmere knows the founding myth: a fire goddess offered " +
      "the first settlers a harbor in exchange for 'the warmth of their children.' " +
      "Nobody agrees on what that means, but every family burns a candle in their " +
      "youngest child's room at night. Outsiders find this charming. Locals do NOT " +
      "joke about it.",
    greatWhy:
      "A specific cultural practice the AI can weave into scenes naturally, " +
      "plus a social rule ('locals do NOT joke about it') that creates tension.",
  },

  location_cultural_significance: {
    whatToPut:
      "Cultural practices, social rules, or traditions tied to this place. " +
      "How do people live here? What are the unwritten rules?",
    poorExample: "The people have their own customs.",
    poorWhy: "The AI has nothing to work with.",
    goodExample:
      "Haggling is considered rude; posted prices are final. Refusing offered " +
      "food is a serious insult.",
    goodWhy: "Concrete social rules that affect how scenes play out.",
    greatExample:
      "Three customs define Ashenmere life: you always eat with your right hand " +
      "(the left is for 'unclean work'), you never ask a dockworker what they're " +
      "hauling (plausible deniability is a social contract), and you bring salt, " +
      "not flowers, to a grieving family. Outsiders who break these rules aren't " +
      "corrected -- they're simply excluded from the next conversation.",
    greatWhy:
      "The AI gets three specific customs it can use in scenes, PLUS the " +
      "consequence of breaking them ('simply excluded') which creates natural conflict.",
  },

  location_scene_use_notes: {
    whatToPut:
      "Writing reminders for scenes set here. What mood should this place evoke? " +
      "What sensory details should the AI emphasize?",
    poorExample: "Use this for action scenes.",
    poorWhy: "Too broad. The AI doesn't know what makes action HERE different from anywhere else.",
    goodExample:
      "Night scenes: emphasize the way fog rolls up from the harbor. " +
      "Chase scenes: narrow streets force vertical movement (rooftops, balconies).",
    goodWhy: "Scene-type-specific guidance.",
    greatExample:
      "Night scenes: fog + torch reflections on wet basalt. The sound " +
      "design is water (dripping, distant waves, rain gutters). " +
      "Chase scenes: the streets are too narrow for horses. Characters go up " +
      "(balconies, laundry lines, temple roofs) not through. " +
      "Quiet scenes: the city never fully sleeps. There's always a ship bell, " +
      "a dog, or a distant argument. Silence here means something is wrong.",
    greatWhy:
      "Per-scene-type sensory cues the AI can apply directly. " +
      "'Silence means something is wrong' is a powerful atmospheric rule.",
  },

  location_notes: {
    whatToPut:
      "Continuity notes, unresolved details, or reminders about this location.",
    poorExample: "Important city.",
    poorWhy: "No information.",
    goodExample:
      "The hidden entrance to the tunnels is through the fishmonger's cellar " +
      "(established Ch. 6). The night market moves locations weekly.",
    goodWhy: "Specific continuity details.",
    greatExample:
      "Continuity: Tunnel entrance is through the fishmonger's cellar (Ch. 6). " +
      "Night market: different plaza each week (Tuesdays). The harbormaster " +
      "is bribed by the rebellion (Sera arranged it, Ch. 8). " +
      "Avoid: describing the upper tiers as 'beautiful' -- they're impressive " +
      "but cold. The beauty is in the lower city's chaotic life.",
    greatWhy:
      "Continuity facts plus a tonal 'Avoid' note that keeps the AI " +
      "consistent with the story's voice.",
  },

  // ── Lore Sections ──────────────────────────────────────────────────────────

  lore_overview: {
    whatToPut:
      "What this lore element IS in one clear statement. Think of it as the " +
      "elevator pitch for this concept.",
    poorExample: "Magic exists in this world.",
    poorWhy: "Every fantasy world has magic. This tells the AI nothing specific.",
    goodExample:
      "Magic is drawn from emotional resonance with natural elements. " +
      "Strong emotion amplifies power; calm precision controls it.",
    goodWhy: "A clear rule with a built-in tension (power vs control).",
    greatExample:
      "The Ember Gift: magic fueled by emotional extremes. Joy heals, rage " +
      "burns, grief freezes. The stronger the feeling, the stronger the effect " +
      "-- but losing control of the emotion means losing control of the spell. " +
      "Most practitioners learn emotional suppression first, magic second.",
    greatWhy:
      "The AI can apply this in scenes: a character casting under emotional " +
      "stress risks losing control. That's built-in conflict.",
  },

  lore_rule_or_concept: {
    whatToPut:
      "The specific rules or mechanics. What are the constraints? What are the costs?",
    poorExample: "It works however the plot needs it to.",
    poorWhy: "The AI will be inconsistent because there are no rules to follow.",
    goodExample:
      "Using the Ember Gift requires physical contact with the target element. " +
      "Each use causes fatigue proportional to the spell's intensity.",
    goodWhy: "Clear mechanics with a cost system.",
    greatExample:
      "Rules: physical contact with the source element required (touching water to " +
      "freeze, touching stone to shape). Cost: fatigue scales exponentially -- a small " +
      "flame is trivial, but reshaping a wall could knock the caster out for hours. " +
      "Hard limit: the Gift cannot resurrect the dead. Attempting it always kills the " +
      "caster. No exceptions in 400 years of recorded history.",
    greatWhy:
      "Graduated costs give the AI a sense of scale, and the hard limit " +
      "('cannot resurrect') prevents plot-breaking scenes.",
  },

  lore_what_it_affects: {
    whatToPut:
      "What parts of the world does this lore element touch? How does it shape " +
      "society, politics, daily life?",
    poorExample: "Magic affects everything.",
    poorWhy: "Too broad. The AI can't apply this to specific scenes.",
    goodExample:
      "The Ember Gift shapes military strategy (Gifted soldiers are elite units), " +
      "architecture (buildings designed to limit fire damage), and social class " +
      "(Gifted families hold political power).",
    goodWhy: "Three concrete domains the AI can reference when relevant.",
    greatExample:
      "Military: Gifted soldiers are deployed as shock troops. Ungifted soldiers " +
      "fear friendly fire more than the enemy. Architecture: every building in " +
      "Ashenmere has a stone-lined 'cool room' for Gifted who lose control. " +
      "Social: Gifted children are identified at age 7 and removed from their " +
      "families for training. This is technically voluntary. In practice, refusing " +
      "is social suicide.",
    greatWhy:
      "Each domain has a specific, scene-ready detail. 'Ungifted soldiers " +
      "fear friendly fire' is a dynamic the AI can use in battle scenes.",
  },

  lore_what_characters_know: {
    whatToPut:
      "What do different characters know (or believe) about this lore element? " +
      "Common knowledge vs expert knowledge vs myths.",
    poorExample: "Everyone knows about magic.",
    poorWhy: "No nuance. The AI writes every character with the same knowledge level.",
    goodExample:
      "Common people know the Gift exists and fear it. Trained practitioners " +
      "understand the emotional mechanics. Only the inner circle of the Academy " +
      "knows about the resurrection taboo.",
    goodWhy: "Three knowledge tiers the AI can match to character backgrounds.",
    greatExample:
      "Common knowledge: the Gift exists, some people have it, don't make a " +
      "Gifted person angry. Popular myth: Gifted can read minds (false, but " +
      "widely believed). Practitioner knowledge: emotional fuel system, fatigue " +
      "costs, element affinity. Inner circle only: the resurrection taboo, the " +
      "Ashenmere Incident of 200 years ago, the true reason the Academy exists.",
    greatWhy:
      "The AI can calibrate dialogue: a farmer says 'don't anger the Gifted,' " +
      "a practitioner discusses fatigue costs, an Academy elder references " +
      "the Incident. Each character sounds appropriately informed.",
  },

  lore_story_relevance: {
    whatToPut:
      "Why does this lore matter to your story right now? Which plot threads " +
      "does it touch? Which characters are affected?",
    poorExample: "It's part of the world.",
    poorWhy: "No connection to the actual story being told.",
    goodExample:
      "Kael's sister's curse may be connected to a misuse of the Ember Gift. " +
      "Sera's latent Gift is awakening, which she's hiding from the group.",
    goodWhy: "Direct connections to active plot threads and characters.",
    greatExample:
      "Active threads: (1) Kael's sister's curse looks like a Gift gone wrong " +
      "-- if he learns this, he'll have to choose between his hatred of magic " +
      "and saving her. (2) Sera's Gift is awakening but she's suppressing it " +
      "because Gifted soldiers get reassigned away from their units. (3) The " +
      "Academy is hunting an unauthorized practitioner in the area -- they " +
      "don't know it's Sera yet.",
    greatWhy:
      "Three active threads with built-in character dilemmas. The AI can " +
      "build tension in any scene involving magic because it knows the stakes.",
  },

  lore_notes: {
    whatToPut:
      "Unresolved questions, continuity reminders, or things to develop later.",
    poorExample: "Needs more work.",
    poorWhy: "Not actionable.",
    goodExample:
      "Undecided: can the Gift be permanently removed? Need to decide before " +
      "Act III. Continuity: Kael saw Sera's eyes glow in Ch. 5 but didn't " +
      "recognize what it meant.",
    goodWhy: "Specific open questions and continuity markers.",
    greatExample:
      "Open questions: Can the Gift be removed? (Needed for Act III resolution.) " +
      "Is the curse on Kael's sister reversible? (Affects ending choice.) " +
      "Continuity: Kael saw Sera's eyes glow in Ch. 5 (hasn't connected the dots). " +
      "The Academy envoy arrives in Ch. 9 (set up in Ch. 7 letter). " +
      "Avoid: explaining Gift mechanics in dialogue dumps. Show through " +
      "consequences, not lectures.",
    greatWhy:
      "Open questions with plot dependencies, continuity tracking, AND a writing " +
      "style note ('show through consequences') that keeps scenes dramatic.",
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// LOOKUP HELPER
// ═══════════════════════════════════════════════════════════════════════════════
// Looks up section help by profile type + section key. Falls back to a generic
// entry if no specific one exists (covers future profile types automatically).

export function getSectionHelp(
  profileType: string,
  sectionKey: string
): SectionHelp | null {
  return SECTION_HELP[`${profileType}_${sectionKey}`] ?? null;
}
