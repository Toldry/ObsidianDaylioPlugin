"use strict";

const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const vaultDir = path.join(rootDir, "obsidian_daylio_plugin_test_vault");
const entriesDir = path.join(vaultDir, "entries");
const attachmentsDir = path.join(vaultDir, "attachments");
const obsidianPluginDir = path.join(vaultDir, ".obsidian", "plugins", "daylio-mood-graph");

// ── Simple seeded PRNG for reproducible mood distribution ────────────────────
function createRng(seed = 19120623) {
	let s = seed >>> 0;
	return function next() {
		s = (Math.imul(1664525, s) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

const rng = createRng();

// ── Date Helpers ─────────────────────────────────────────────────────────────
const MONTH_NAMES = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December"
];
const WEEKDAY_NAMES = [
	"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
];

function formatISODate(date) {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

// ── Dramatic Mood Simulation Parameters ──────────────────────────────────────
// Mood scale: awful, bad, meh, good, rad
function getMoodWeightsForDate(isoDate) {
	// ── 1. Edge Case: 1 Single Mood Only (100% awful or 100% rad or 100% good)
	if (isoDate >= "1945-06-15" && isoDate <= "1945-06-25") {
		// Midsummer post-war victory euphoria: 100% rad
		return [
			{ mood: "awful", weight: 0.00 },
			{ mood: "bad", weight: 0.00 },
			{ mood: "meh", weight: 0.00 },
			{ mood: "good", weight: 0.00 },
			{ mood: "rad", weight: 1.00 },
		];
	}
	if (isoDate >= "1952-07-12" && isoDate <= "1952-07-20") {
		// Bergen mountain trail trek with Kjell: 100% good
		return [
			{ mood: "awful", weight: 0.00 },
			{ mood: "bad", weight: 0.00 },
			{ mood: "meh", weight: 0.00 },
			{ mood: "good", weight: 1.00 },
			{ mood: "rad", weight: 0.00 },
		];
	}
	if (isoDate >= "1952-04-15" && isoDate <= "1952-05-05") {
		// Acute peak nausea from hormone injections: 100% awful
		return [
			{ mood: "awful", weight: 1.00 },
			{ mood: "bad", weight: 0.00 },
			{ mood: "meh", weight: 0.00 },
			{ mood: "good", weight: 0.00 },
			{ mood: "rad", weight: 0.00 },
		];
	}

	// ── 2. Edge Case: Exactly 2 Moods (e.g. 100% awful/bad OR 100% rad/good)
	if (isoDate >= "1952-04-01" && isoDate <= "1952-06-15") {
		// Severe post-trial hormone therapy period: 70% awful, 30% bad
		return [
			{ mood: "awful", weight: 0.70 },
			{ mood: "bad", weight: 0.30 },
			{ mood: "meh", weight: 0.00 },
			{ mood: "good", weight: 0.00 },
			{ mood: "rad", weight: 0.00 },
		];
	}
	if (isoDate >= "1954-05-20" && isoDate <= "1954-06-07") {
		// Final weeks leading to June 7, 1954: 80% awful, 20% bad
		return [
			{ mood: "awful", weight: 0.80 },
			{ mood: "bad", weight: 0.20 },
			{ mood: "meh", weight: 0.00 },
			{ mood: "good", weight: 0.00 },
			{ mood: "rad", weight: 0.00 },
		];
	}
	if (isoDate >= "1945-05-08" && isoDate <= "1945-08-31") {
		// VE Day & Post-War Liberation Summer: 60% rad, 40% good
		return [
			{ mood: "awful", weight: 0.00 },
			{ mood: "bad", weight: 0.00 },
			{ mood: "meh", weight: 0.00 },
			{ mood: "good", weight: 0.40 },
			{ mood: "rad", weight: 0.60 },
		];
	}
	if (isoDate >= "1947-06-01" && isoDate <= "1947-08-31") {
		// Peak Athletic Marathon Season (Walton AC races): 55% rad, 45% good
		return [
			{ mood: "awful", weight: 0.00 },
			{ mood: "bad", weight: 0.00 },
			{ mood: "meh", weight: 0.00 },
			{ mood: "good", weight: 0.45 },
			{ mood: "rad", weight: 0.55 },
		];
	}
	if (isoDate >= "1952-07-05" && isoDate <= "1952-07-30") {
		// Norway Fjord Holiday with Kjell Nilsen: 50% rad, 50% good
		return [
			{ mood: "awful", weight: 0.00 },
			{ mood: "bad", weight: 0.00 },
			{ mood: "meh", weight: 0.00 },
			{ mood: "good", weight: 0.50 },
			{ mood: "rad", weight: 0.50 },
		];
	}
	if (isoDate >= "1953-08-01" && isoDate <= "1953-08-30") {
		// Mediterranean Holiday in Corfu & Athens: 50% rad, 50% good
		return [
			{ mood: "awful", weight: 0.00 },
			{ mood: "bad", weight: 0.00 },
			{ mood: "meh", weight: 0.00 },
			{ mood: "good", weight: 0.50 },
			{ mood: "rad", weight: 0.50 },
		];
	}

	// ── 3. Breakthrough & Creative Joy (3 Moods: rad, good, meh — 0% awful/bad)
	if (isoDate >= "1936-05-01" && isoDate <= "1936-07-31") {
		// Inventing universal logical computing machines & paper submission
		return [
			{ mood: "awful", weight: 0.00 },
			{ mood: "bad", weight: 0.00 },
			{ mood: "meh", weight: 0.15 },
			{ mood: "good", weight: 0.45 },
			{ mood: "rad", weight: 0.40 },
		];
	}
	if (isoDate >= "1940-03-01" && isoDate <= "1940-08-31") {
		// Bombe machines "Victory" & "Spider" operational breakthroughs
		return [
			{ mood: "awful", weight: 0.00 },
			{ mood: "bad", weight: 0.05 },
			{ mood: "meh", weight: 0.15 },
			{ mood: "good", weight: 0.45 },
			{ mood: "rad", weight: 0.35 },
		];
	}
	if (isoDate >= "1941-03-01" && isoDate <= "1941-05-31") {
		// Engagement to Joan & naval Enigma keys falling in Hut 8
		return [
			{ mood: "awful", weight: 0.00 },
			{ mood: "bad", weight: 0.00 },
			{ mood: "meh", weight: 0.15 },
			{ mood: "good", weight: 0.45 },
			{ mood: "rad", weight: 0.40 },
		];
	}
	if (isoDate >= "1950-09-01" && isoDate <= "1951-04-30") {
		// Mind paper (Imitation Game), Ferranti Mark 1 delivered, elected FRS
		return [
			{ mood: "awful", weight: 0.00 },
			{ mood: "bad", weight: 0.02 },
			{ mood: "meh", weight: 0.13 },
			{ mood: "good", weight: 0.45 },
			{ mood: "rad", weight: 0.40 },
		];
	}
	if (isoDate >= "1951-09-01" && isoDate <= "1951-11-30") {
		// Reaction-diffusion morphogenesis breakthroughs & sunflower phyllotaxis
		return [
			{ mood: "awful", weight: 0.00 },
			{ mood: "bad", weight: 0.02 },
			{ mood: "meh", weight: 0.13 },
			{ mood: "good", weight: 0.40 },
			{ mood: "rad", weight: 0.45 },
		];
	}

	// ── 4. High-Stress Crisis Periods (heavy bad/awful/meh — 0% rad)
	if (isoDate >= "1942-02-01" && isoDate <= "1942-10-31") {
		// Kriegsmarine 4-rotor Triton/Shark blackout: Allied convoys blind in Atlantic
		return [
			{ mood: "awful", weight: 0.25 },
			{ mood: "bad", weight: 0.50 },
			{ mood: "meh", weight: 0.20 },
			{ mood: "good", weight: 0.05 },
			{ mood: "rad", weight: 0.00 },
		];
	}
	if (isoDate >= "1952-01-15" && isoDate <= "1952-03-31") {
		// Burglary, police interrogation, arrest, and trial at Knutsford
		return [
			{ mood: "awful", weight: 0.40 },
			{ mood: "bad", weight: 0.45 },
			{ mood: "meh", weight: 0.15 },
			{ mood: "good", weight: 0.00 },
			{ mood: "rad", weight: 0.00 },
		];
	}

	// ── 5. Frustrating Bureaucratic Delays (NPL ACE battles)
	if (isoDate >= "1945-10-01" && isoDate <= "1947-05-31") {
		return [
			{ mood: "awful", weight: 0.10 },
			{ mood: "bad", weight: 0.45 },
			{ mood: "meh", weight: 0.35 },
			{ mood: "good", weight: 0.10 },
			{ mood: "rad", weight: 0.00 },
		];
	}

	// ── 6. Wartime baseline at Bletchley (1939-1945)
	if (isoDate >= "1939-09-01" && isoDate <= "1945-05-07") {
		return [
			{ mood: "awful", weight: 0.08 },
			{ mood: "bad", weight: 0.22 },
			{ mood: "meh", weight: 0.40 },
			{ mood: "good", weight: 0.22 },
			{ mood: "rad", weight: 0.08 },
		];
	}

	// ── 7. Standard Academic Baseline (Cambridge, Princeton, Manchester)
	return [
		{ mood: "awful", weight: 0.02 },
		{ mood: "bad", weight: 0.13 },
		{ mood: "meh", weight: 0.45 },
		{ mood: "good", weight: 0.30 },
		{ mood: "rad", weight: 0.10 },
	];
}

function pickMood(weights) {
	const r = rng();
	let cumulative = 0;
	for (const item of weights) {
		cumulative += item.weight;
		if (r <= cumulative) return item.mood;
	}
	return weights[weights.length - 1].mood;
}

function pickTimes(count) {
	const candidateTimes = ["08:15", "09:30", "11:10", "13:45", "16:20", "19:15", "21:30", "23:05"];
	if (count === 1) {
		return [candidateTimes[Math.floor(rng() * candidateTimes.length)]];
	}
	const shuffled = [...candidateTimes].sort(() => rng() - 0.5);
	return shuffled.slice(0, count).sort();
}

// ── Generate CSV Data ────────────────────────────────────────────────────────
function generateCsvData(startDateStr, endDateStr) {
	const startDate = new Date(startDateStr + "T00:00:00");
	const endDate = new Date(endDateStr + "T00:00:00");

	const rows = [];
	rows.push("full_date,date,weekday,time,mood,activities,note_title,note");

	const currentDate = new Date(startDate);
	while (currentDate <= endDate) {
		const isoDate = formatISODate(currentDate);
		const monthName = MONTH_NAMES[currentDate.getMonth()];
		const dayNum = currentDate.getDate();
		const dateFormatted = `${monthName} ${dayNum}`;
		const weekday = WEEKDAY_NAMES[currentDate.getDay()];

		const rCount = rng();
		let entryCount = 1;
		const isBoundaryDate = (isoDate === startDateStr || isoDate === endDateStr);
		const isClusterDate = (isoDate >= "1952-07-10" && isoDate <= "1952-07-14");

		if (rCount < 0.15 && !isBoundaryDate && !isClusterDate) {
			// 15% lacuna (0 entries)
			entryCount = 0;
		} else if (rCount < 0.15 + 0.04) {
			// 4% 2 entries
			entryCount = 2;
		} else if (rCount < 0.15 + 0.04 + 0.02) {
			// 2% 3 entries
			entryCount = 3;
		} else {
			// 79% 1 entry
			entryCount = 1;
		}

		if (entryCount > 0) {
			const weights = getMoodWeightsForDate(isoDate);
			const times = pickTimes(entryCount);
			for (let i = 0; i < entryCount; i++) {
				const mood = pickMood(weights);
				const time = times[i];
				rows.push(`${isoDate},${dateFormatted},${weekday},${time},${mood},,,`);
			}
		}

		currentDate.setDate(currentDate.getDate() + 1);
	}

	return rows.join("\n");
}

// ── Authentic Diary Entries (Max 3 Sentences, Turing's Voice, NO Tags) ─────────
const VAULT_ENTRIES = [
	// ── 1936–1938: Cambridge & Princeton ─────────────────────────────────────
	{
		filename: "1936-05-01 Theoretical Breakthrough on Paper Tape.md",
		frontmatter: {
			daylio_event: "Inventing Universal Computing Machines | 1936-05-01 -> 1936-07-31",
		},
		content:
			"Lying in the Grantchester meadows after a hard run, the concept of a single logical computing machine scanning an endless tape of binary squares became transparently clear. It resolves the decision problem by showing that no general method exists to determine provability. I have begun drafting the complete mathematical proof.",
	},
	{
		filename: "1936-05-28 Computable Numbers Manuscript.md",
		frontmatter: {
			daylio_event: "Delivered Computable Numbers paper to London Math Society",
		},
		content:
			"Delivered my paper on computable numbers and logical computing machines to Newman for transmission to the London Mathematical Society. The notion of a single universal machine reading an endless paper tape settles Hilbert's Entscheidungsproblem once and for all. Celebrated with a solitary pint at the pub.",
	},
	{
		filename: "1936-09-20 Setting Sail for Princeton.md",
		frontmatter: {
			daylio_event: "Doctoral Studies with Alonzo Church | 1936-09-20 -> 1938-06-15",
		},
		content:
			"Arrived in New Jersey to take up research with Alonzo Church at the Graduate College. The Gothic towers feel like an earnest American caricature of Cambridge, but the mathematicians here are remarkably acute. Must write to mother about the voyage.",
	},
	{
		filename: "1936-11-12 Constructing Binary Multipliers.md",
		subfolder: "princeton",
		frontmatter: {
			daylio_event: "Building electromagnetic relays",
		},
		content:
			"Spent the evening in the physics laboratory workshop with MacPhail building binary multiplier relays. The clatter of the copper armatures is thoroughly satisfying when the logic gates latch correctly. I rather enjoy getting grease on my fingers after days of pure logic.",
	},
	{
		filename: "1937-01-15 Computable Numbers Published.md",
		frontmatter: {
			daylio_event: "Computable numbers paper published in Proceedings",
		},
		content:
			"The first offprints arrived in the morning mail from London. It is odd seeing my logical computing machines set in heavy printer's ink after so many months of messy pencil scribbles. Sent a copy to Clock House for Mrs. Morcom.",
	},
	{
		filename: "1937-06-10 Summer Stroll to Clock House.md",
		frontmatter: {
			daylio_event: "Visiting Mrs Morcom at Clock House | 1937-06-10",
		},
		content:
			"Took the train down to Byfleet to visit Christopher's mother at Clock House. We sat in the garden talking of his old astronomy charts and how much he would have relished modern logic. His memory is still as clear and luminous to me as seven years ago.",
	},
	{
		filename: "1937-08-14 Cycling Across New Jersey.md",
		content:
			"Bicycled thirty miles out past Kingston along the canal paths. The humid American summer heat is unbearable indoors, but the breeze on the road clears the cobwebs. Stopped at a roadside stand for fresh cider.",
	},
	{
		filename: "1938-06-15 Conferred Doctor of Philosophy.md",
		frontmatter: {
			daylio_event: "PhD conferred at Princeton | 1938-06-15",
		},
		content:
			"Defended my dissertation on systems of logic based on ordinals with Church and von Neumann. Von Neumann offered me a temporary post as his assistant here, which was flattering. But King's College is calling me home to England.",
	},
	{
		filename: "1938-09-01 King's Fellowship Lectures.md",
		frontmatter: {
			daylio_event: "King's College Fellowship | 1938-09-01 -> 1939-09-03",
		},
		content:
			"Back in my old college rooms overlooking the river Cam. Began lecturing on the foundations of mathematics, with Ludwig Wittgenstein attending from across the court. Our arguments over whether contradictions actually harm a bridge design are becoming legendary.",
	},

	// ── 1939–1945: Bletchley Park & Wartime ──────────────────────────────────
	{
		filename: "1939-09-04 Arrival at Station X.md",
		subfolder: "bletchley",
		frontmatter: {
			daylio_event: "Bletchley Park Codebreaking Service | 1939-09-04 -> 1945-05-08",
		},
		content:
			"Reported to Bletchley Park immediately following Chamberlain's radio broadcast. The Victorian mansion is dreary and overcrowded with linguists and chess players, but the cryptographic challenge is magnificent. We must construct machines to break their Enigma swiftly.",
	},
	{
		filename: "1939-11-01 Section Head of Hut 8.md",
		subfolder: "bletchley",
		frontmatter: {
			daylio_event: "Head of Hut 8 Naval Enigma | 1939-11-01 to 1942-10-31",
		},
		content:
			"Took charge of Hut 8 to tackle the German Naval cipher, which everyone else had written off as impenetrable. The Kriegsmarine uses complex indicator books and an extra wheel, but their operators are creatures of habit. Set up our preliminary tables today.",
	},
	{
		filename: "1940-03-18 First Bombe Machine Victory.md",
		subfolder: "bletchley",
		frontmatter: {
			daylio_event: "First Bombe machine Victory installed",
		},
		content:
			"Our first electromechanical searching machine, 'Victory', arrived from Letchworth and was wired up in the cottage. The synchronized clicking of thirty revolving drums sounded like a mechanical orchestra. It found its first key setting before midnight.",
	},
	{
		filename: "1940-06-22 Cycling with Gas Mask.md",
		subfolder: "bletchley",
		frontmatter: {
			daylio_event: "Hay fever gas mask commute",
		},
		content:
			"The grass pollen around the Buckinghamshire meadows has brought on my annual violent hay fever. Pedaled the three miles from Shenley to Hut 8 wearing my standard army service gas mask. The gate sentries looked bewildered, but my eyes didn't stream once.",
	},
	{
		filename: "1940-08-08 Spider Bombe Operational.md",
		subfolder: "bletchley",
		frontmatter: {
			daylio_event: "Spider Bombe with diagonal board running",
		},
		content:
			"Welchman's idea of a diagonal board has transformed the Bombe into a terrifyingly potent instrument. We ran the new machine, 'Agnus Dei', against today's Luftwaffe traffic and broke the keys within an hour. The German cipher staff have no inkling.",
	},
	{
		filename: "1940-10-15 Chaining Tea Mug to Radiator.md",
		subfolder: "bletchley",
		content:
			"Grew weary of finding my chipped porcelain tea mug missing from the desk every morning. Padlocked it securely around the cast-iron hot water pipe by the Hut 8 window. It looks absurd, but property rights are now definitively established.",
	},
	{
		filename: "1941-03-15 Proposed to Joan Clarke.md",
		frontmatter: {
			daylio_start: "1941-03-15",
			daylio_end: "1941-08-25",
			daylio_event: "Engagement to Joan Clarke",
		},
		content:
			"Asked Joan to marry me during a walk past the lake after our shift, and to my delight she accepted. She is the quickest mind in Hut 8 and understands my oddities better than anyone in England. Gave her a ring over the weekend.",
	},
	{
		filename: "1941-06-02 Rudge Bicycle Chain Geometry.md",
		subfolder: "bletchley",
		content:
			"Discovered that the chain on my bicycle only derails when a faulty link meets a bent cog tooth after precisely fourteen pedal revolutions. By back-pedaling once every thirteen strokes, I can commute from my cottage without dismounting. Who needs a bicycle repair shop when one has modular arithmetic?",
	},
	{
		filename: "1941-08-25 Parting as Friends with Joan.md",
		frontmatter: {
			daylio_event: "Broke engagement with Joan | 1941-08-25",
		},
		content:
			"Took Joan aside and told her honestly of my homosexual nature, quoting Oscar Wilde's ballad. She was wonderfully calm and affectionate, saying it made no difference, but we agreed it would be wrong to proceed with marriage. We remain the closest of confidantes.",
	},
	{
		filename: "1941-10-21 Hand Delivering Letter to PM.md",
		subfolder: "bletchley",
		frontmatter: {
			daylio_events: [
				"Urgent staff petition to Churchill",
				"Churchill orders Action This Day | 1941-10-22",
			],
		},
		content:
			"Tired of bureaucratic squabbling in Whitehall, Alexander, Welchman, Milner-Barry, and I sent a courier directly to 10 Downing Street. Churchill replied overnight with his red 'Action This Day' stamp, ordering that all our demands be met immediately. The relief in the hut is palpable.",
	},
	{
		filename: "1942-02-01 Shark Blackout Crisis.md",
		subfolder: "bletchley",
		frontmatter: {
			daylio_event: "Atlantic M4 Enigma Blackout | 1942-02-01 -> 1942-06-30",
		},
		content:
			"Disaster in the Atlantic: the U-boats have introduced a fourth rotor, M4, plunging Hut 8 into total darkness. The Admiralty reports horrific convoy tonnage losses daily while we work twenty-hour shifts trying to recover the new Greek wheel wirings. It is agonizing feeling so powerless.",
	},
	{
		filename: "1942-05-18 Running from Bletchley to Ely.md",
		subfolder: "bletchley",
		frontmatter: {
			daylio_event: "Forty-mile cross-country run to Ely",
		},
		content:
			"Needed to escape the claustrophobia of Hut 8, so I ran forty miles along the fenland tracks to Ely. The steady pounding of shoes on turf is the only remedy I know for an overtired brain. Slept twelve hours straight afterwards.",
	},
	{
		filename: "1942-11-12 Secret Crossing to America.md",
		frontmatter: {
			daylio_event: "Mission to Bell Labs & Washington | 1942-11-12 .. 1943-03-24",
		},
		content:
			"Sailed in convoy aboard the Queen Elizabeth under complete secrecy. Sent to evaluate the American Bombe production in Dayton and liaise with Bell Labs in New York on speech encryption. Had fascinating lunchtime arguments with Claude Shannon on information theory.",
	},
	{
		filename: "1943-06-01 Speech Scrambler at Hanslope.md",
		frontmatter: {
			daylio_event: "Project Delilah Voice Scrambler | 1943-06-01 -> 1945-12-31",
		},
		content:
			"Set up a dedicated electronics laboratory with Don Bayley in the outbuildings at Hanslope Park. We are building 'Delilah', a portable speech scrambler using modular electronic noise addition. If it works, Churchill can talk securely to Roosevelt without risk of interception.",
	},
	{
		filename: "1944-06-06 Decrypting During the Landings.md",
		subfolder: "bletchley",
		frontmatter: {
			daylio_event: "D-Day Normandy decryption vigil",
		},
		content:
			"Stayed up all night decoding tactical signals as Allied troops hit the Normandy beaches. Our decrypts confirmed that the German high command still expects the real assault at Pas-de-Calais. Our deception held, and countless lives have been saved.",
	},
	{
		filename: "1944-11-20 Testing Churchill Voice on Delilah.md",
		frontmatter: {
			daylio_event: "",
		},
		content:
			"Tested the Delilah prototype by scrambling and reconstituting a gramophone recording of one of Churchill's speeches. Don and I listened to the output through headphones; the voice was slightly robotic but perfectly intelligible. The mathematics holds up in vacuum tubes.",
	},
	{
		filename: "1945-05-08 VE Day Victory in Europe.md",
		frontmatter: {
			daylio_event: "VE Day & European Victory Celebrations | 1945-05-08 -> 1945-06-30",
		},
		content:
			"The war in Europe is officially over. Crowds are dancing in the streets of London and Bletchley, but our role must remain completely secret forever. Walked quietly through the park feeling an overwhelming sense of relief and quiet triumph.",
	},
	{
		filename: "1945-06-15 Midsummer Swimming at the River.md",
		frontmatter: {
			daylio_event: "Midsummer Lake Swimming | 1945-06-15 -> 1945-06-25",
		},
		content:
			"Spent a pure ten days swimming in the warm river every afternoon after work at Hanslope. With peace returned to Europe, the quiet beauty of the countryside feels completely renewed. Pure bliss without wartime sirens.",
	},
	{
		filename: "1945-07-01 Post-War Bletchley Wind-Down.md",
		subfolder: "bletchley",
		frontmatter: {
			daylio_event: "Post-War Bletchley Wind-Down | 1945-07-01 -> 1945-08-31",
		},
		content:
			"Packing up equipment and burning non-essential papers as Hut 8 begins to disband. Many colleagues are returning to Oxford and Cambridge professorships. I am eager to apply our electronic techniques to peacetime computation.",
	},
	{
		filename: "1945-09-04 Order of the British Empire.md",
		frontmatter: {
			daylio_event: "Awarded OBE by King George VI",
		},
		content:
			"Traveled to Buckingham Palace to receive the Officer of the Order of the British Empire from the King. The official citation vaguely mentions wartime services to the Foreign Office. Kept the medal in my drawer alongside bicycle tools.",
	},

	// ── 1945–1948: NPL, ACE Design & Running ──────────────────────────────────
	{
		filename: "1945-10-01 Automatic Computing Engine Blueprint.md",
		frontmatter: {
			daylio_event: "ACE Design at National Physical Lab | 1945-10-01 -> 1947-09-30",
		},
		content:
			"Began work at the National Physical Laboratory in Teddington designing the ACE: a universal stored-program electronic computer. I do not want a mere calculator, but an active brain capable of storing and modifying its own instructions. Wrote the first fifty pages of specifications.",
	},
	{
		filename: "1946-02-19 Presenting ACE to NPL Committee.md",
		frontmatter: {
			daylio_event: "Proposed full electronic computer to NPL",
		},
		content:
			"Read my paper on the Automatic Computing Engine to the Executive Committee of the NPL. Outlined mercury acoustic delay lines, micro-programming, and subroutines. Sir Charles Darwin seemed slightly overwhelmed by the speed, but agreed in principle.",
	},
	{
		filename: "1946-07-14 Rowing on the Thames.md",
		content:
			"Hired a light scull and rowed five miles up the Thames past Kingston lock. It is good to be outdoors away from committee meetings that drag on with no decisions. My back is comfortably stiff tonight.",
	},
	{
		filename: "1947-03-20 Delays and Bureaucratic Stagnation.md",
		frontmatter: {
			daylio_event: "Frustrations with NPL administration",
		},
		content:
			"Eighteen months since I delivered the ACE blueprints, and NPL has yet to solder a single vacuum tube. The engineers at Telecommunications Research are ready, but our administrators refuse to subcontract. I am thoroughly sick of memos and civil service inertia.",
	},
	{
		filename: "1947-06-01 Peak Marathon Training Season.md",
		frontmatter: {
			daylio_event: "Peak Marathon Season Walton AC | 1947-06-01 -> 1947-08-31",
		},
		content:
			"Training relentlessly with Walton Athletic Club along the Thames towpath and grass tracks. Running ten miles every evening in sub-six-minute mile pace. My cardiovascular condition has never been sharper.",
	},
	{
		filename: "1947-08-23 Marathon Championship PB.md",
		frontmatter: {
			daylio_event: [
				"Marathon personal best 2h 46m 03s",
				"Fifth place in AAA National Championship | 1947-08-23",
			],
		},
		content:
			"Ran the AAA Marathon championship race today for Walton Athletic Club, finishing in 2 hours 46 minutes and 3 seconds. Placed fifth in all of Britain, only a few minutes behind the Olympic trial pace. When I run fast, my mind completely lets go of mathematical fatigue.",
	},
	{
		filename: "1947-10-01 Sabbatical Year at Cambridge.md",
		frontmatter: {
			daylio_event: "Cambridge Sabbatical & Neural Networks | 1947-10-01 -> 1948-09-30",
		},
		content:
			"Returned to King's College on a year's leave to study neurology and physiology. Writing a report on 'Intelligent Machinery' investigating how unorganized networks of simple switches can train themselves into ordered brains. It feels like the genuine future of computing.",
	},

	// ── 1948–1951: Manchester, Imitation Game & Morphogenesis ────────────────
	{
		filename: "1948-10-01 Reader in Mathematics at Manchester.md",
		frontmatter: {
			// Ongoing range event without an end date!
			daylio_event: "Manchester Computing Machine Laboratory | 1948-10-01 -> ",
		},
		content:
			"Moved north to Manchester University to join Max Newman and build software for the new electronic computing machine. Williams and Kilburn already have their prototype 'Baby' working with cathode-ray storage. Bought a house in Wilmslow called Hollymeade.",
	},
	{
		filename: "1949-06-20 First Programs on Manchester Mark 1.md",
		frontmatter: {
			daylio_event: "Writing Programmer's Handbook | 1949-06-20",
		},
		content:
			"Finished drafting the world's first programmer's handbook for the Manchester Mark 1, using base-32 teleprinter characters. Fed the machine routine instructions to compute Mersenne primes. Seeing numbers glow on the cathode monitor is utterly magical.",
	},
	{
		filename: "1949-11-05 Matchstick Chess with Donald Michie.md",
		subfolder: "manchester",
		content:
			"Donald came up to Manchester for the weekend and we spent all evening testing our paper chess program 'Turochamp'. We burned matchsticks to time each move when the clock broke. He eventually outflanked my king's bishop.",
	},
	{
		filename: "1950-04-12 Porgy and the Unorganized Machines.md",
		subfolder: "manchester",
		content:
			"Sat my teddy bear Porgy on the mantlepiece and explained to him how genetic search could train a neural net. He listened with immense patience without raising a single objection. Robin laughed when he saw us.",
	},
	{
		filename: "1950-05-01 Life at Hollymeade.md",
		frontmatter: {
			// Another ongoing range event without end date
			daylio_event: "Life at Hollymeade in Wilmslow | 1950-05-01 -> ",
		},
		content:
			"Settled into my detached home in Wilmslow, setting up a workshop in the spare room and planting roses in the back garden. It provides the quiet solitude necessary for long uninterrupted calculations.",
	},
	{
		filename: "1950-10-01 The Imitation Game Paper in Mind.md",
		frontmatter: {
			daylio_event: "Published Computing Machinery and Intelligence in Mind",
		},
		content:
			"My philosophical paper on machine intelligence has been published in Mind. Proposed the Imitation Game to replace the murky question of 'can machines think' with a concrete behavioral test. The theological objections I countered are already drawing irritated letters from clergymen.",
	},
	{
		filename: "1951-02-15 Ferranti Mark 1 Installation.md",
		frontmatter: {
			daylio_event: "Ferranti Mark 1 delivered to lab",
		},
		content:
			"The first commercial Ferranti Mark 1 computer was delivered and wired into our laboratory today. Now we have two full cathode-ray stores and a high-speed magnetic drum. I can finally run numerical simulations of biological cell patterns.",
	},
	{
		filename: "1951-03-15 Fellow of the Royal Society.md",
		frontmatter: {
			// Ongoing range event without an end date!
			daylio_event: "Fellow of the Royal Society | 1951-03-15 -> ",
		},
		content:
			"Received notification this morning of election to the Royal Society. A wonderful honor from my peers for the computable numbers work and logic foundations. Celebrated by buying myself a decent violin to learn.",
	},
	{
		filename: "1951-09-01 Morphogenesis Reaction Diffusion Breakthrough.md",
		frontmatter: {
			daylio_event: "Reaction-Diffusion Morphogenesis Theory | 1951-09-01 -> 1951-11-30",
		},
		content:
			"Discovered that a system of two reacting chemicals with differing diffusion rates spontaneously generates periodic spatial patterns from perfect homogeneity. The equations model leopard spots, zebra stripes, and gastrulation with astonishing fidelity.",
	},
	{
		filename: "1951-11-09 Chemical Basis of Morphogenesis.md",
		frontmatter: {
			daylio_event: "Submitted Morphogenesis paper to Royal Society",
		},
		content:
			"Sent off 'The Chemical Basis of Morphogenesis' to the Philosophical Transactions. Proved mathematically that two diffusing chemical substances undergoing non-linear reactions will spontaneously break symmetry and generate stripes, spots, and spiral whorls. Nature's beauty is differential equations.",
	},
	{
		filename: "1951-12-14 Sunflowers and Fibonacci Spirals.md",
		subfolder: "manchester",
		frontmatter: {
			daylio_event: "Phyllotaxis | Daisy and sunflower patterns",
		},
		content:
			"Spent the afternoon in the botanical gardens counting seed spirals on over a hundred dried sunflower heads. Nearly all adhere strictly to Fibonacci ratios 34, 55, and 89. Programmed the Ferranti machine to simulate the primordia growth steps.",
	},

	// ── 1952–1954: Arrest, Trial, Holidays & Final Days ───────────────────────
	{
		filename: "1952-01-20 Met Arnold Murray.md",
		subfolder: "manchester",
		content:
			"Met a young fellow named Arnold Murray on Oxford Road outside the Regal cinema. Invited him over to Hollymeade for supper and conversation. He is rather rough around the edges but lively company.",
	},
	{
		filename: "1952-02-07 Reporting Burglary to Police.md",
		frontmatter: {
			daylio_event: "Reported burglary at Hollymeade | 1952-02-07",
		},
		content:
			"Discovered twenty pounds and several shirts stolen from the house and reported it to the local police. When questioned about my connection to Arnold, I saw no reason to dissemble and spoke openly of our relationship. The detectives suddenly turned coldly hostile.",
	},
	{
		filename: "1952-03-31 Trial at Knutsford Quarter Sessions.md",
		frontmatter: {
			daylio_event: "Sentence of Estrogen Hormone Treatment | 1952-03-31 -> 1953-03-31",
		},
		content:
			"Appeared at Knutsford Quarter Sessions charged under Section 11. To avoid two years imprisonment and continue mathematical research, I submitted to twelve months of probation with mandatory estrogen injections. My government security clearances have been immediately rescinded.",
	},
	{
		filename: "1952-04-01 Severe Estrogen Injections.md",
		frontmatter: {
			daylio_event: "Severe Estrogen Hormone Injections | 1952-04-01 -> 1952-06-15",
		},
		content:
			"The daily stilboestrol chemical injections have begun in full force. The nausea and bodily distortion are unbearable, making it nearly impossible to sit at my desk or concentrate on mathematics. I feel stripped of all dignity by this barbaric sentence.",
	},
	{
		filename: "1952-05-10 Severe Side Effects of Injections.md",
		frontmatter: {
			daylio_event: "Stilboestrol hormone treatment ordeal",
		},
		content:
			"The bodily effects of the daily stilboestrol injections are wretched beyond description; my breasts are swelling and I feel an all-pervading physical lethargy. Tried to work on non-linear equations, but the nausea made concentration impossible. Must endure this with stoicism.",
	},
	{
		filename: "1952-07-10 Escape to Norway with Kjell Nilsen.md",
		subfolder: "holidays",
		frontmatter: {
			daylio_event: "Arrival in Bergen with Kjell",
		},
		content:
			"Escaped England for the dramatic fjords and crisp northern air of Norway. Met a delightful young Norwegian friend, Kjell Nilsen, in Bergen and spent weeks hiking along the mountain trails. For the first time in months, I can breathe without shame.",
	},
	{
		filename: "1952-07-11 Walking along the Fjord.md",
		subfolder: "holidays",
		content:
			"Gentle walk along the waterside in the morning mist. The silence is profound.",
	},
	{
		filename: "1952-07-12 Bergen Trail Hike.md",
		subfolder: "holidays",
		frontmatter: {
			daylio_event: "Bergen Mountain Trekking | 1952-07-12 -> 1952-07-20",
		},
		content:
			"Kjell and I hiked up above the cloud line on the mountains surrounding Bergen. The pure Scandinavian sunlight and pine scents are wonderful medicine after the bleakness of Manchester courts. We laughed freely all afternoon.",
	},
	{
		filename: "1952-07-13 Rest Day at the Cabin.md",
		subfolder: "holidays",
		content:
			"Rain on the roof all morning. Spent hours reading and sketching pine cone spirals.",
	},
	{
		filename: "1952-07-14 Coastal Boat Ride.md",
		subfolder: "holidays",
		content:
			"Took a small wooden ferry across the inlet. The cool sea spray was invigorating.",
	},
	{
		filename: "1953-03-31 End of Hormone Probation.md",
		frontmatter: {
			daylio_event: "Completed 12 months hormone probation | 1953-03-31",
		},
		content:
			"Received medical confirmation that the twelve-month organo-therapy probation has concluded. The physical side effects should gradually subside now that the injections have ceased. Returning to my morphogen simulations with renewed vigor.",
	},
	{
		filename: "1953-06-18 Kjell Visits Hollymeade.md",
		subfolder: "manchester",
		content:
			"Kjell Nilsen came over from Norway to stay with me at Wilmslow for a fortnight. Discovered that the local police and Special Branch have placed my house under continuous surveillance, terrified of foreign contacts. We ignored them and went for long bike rides in the Peak District.",
	},
	{
		filename: "1953-08-01 Holiday in Corfu and Athens.md",
		subfolder: "holidays",
		frontmatter: {
			daylio_event: "Corfu & Athens Mediterranean Holiday | 1953-08-01 -> 1953-08-30",
		},
		content:
			"Spent a glorious month swimming in the turquoise waters of Corfu and exploring ancient temples in Athens. The Mediterranean sun has warmed my bones after a bitterly cold English winter. Collected sea shells displaying logarithmic spiral patterns.",
	},
	{
		filename: "1953-12-24 Christmas at Guildford with Mother.md",
		content:
			"Spent Christmas Eve with mother at Guildford, helping her string paper lanterns in the parlor. We chatted cheerfully about childhood chemistry sets and gardening rather than recent troubles. Returned home to Wilmslow on Boxing Day.",
	},
	{
		filename: "1954-03-12 Gold Electroplating in Spare Bedroom.md",
		subfolder: "manchester",
		frontmatter: {
			daylio_event: "Electrochemical plating experiments",
		},
		content:
			"Set up a small electrochemical bath in my spare bedroom at Hollymeade to electroplate brass spoons with genuine gold. Used potassium cyanide solution and galvanic cells. The golden deposit on the spoons came out bright and smooth.",
	},
	{
		filename: "1954-05-20 Dark Shadows in Wilmslow.md",
		frontmatter: {
			daylio_event: "Final Descent in Wilmslow | 1954-05-20 -> 1954-06-07",
		},
		content:
			"A heavy melancholy has settled over Hollymeade that no amount of mathematical work can disperse. The continued police surveillance and loss of my government colleagues weigh like lead. Everything feels increasingly futile.",
	},
	{
		filename: "1954-06-07 Final Night at Hollymeade.md",
		frontmatter: {
			daylio_event: "Final evening in Wilmslow",
		},
		content:
			"Spent the afternoon working on the morphogenesis of sunflower seed phyllotaxis on the Manchester machine. The June garden at Hollymeade is peaceful and full of blooming roses. Left an apple on the bedside table before retiring for the night.",
	},
	{
		filename: "1935-12-25 Christmas Before CSV Range.md",
		frontmatter: {
			daylio_event: "Before CSV range",
		},
		content:
			"Winter holiday at Guildford before the new academic term. Working on early logic proofs.",
	},
	{
		filename: "1955-12-31 New Year After CSV Range.md",
		frontmatter: {
			daylio_event: "After CSV range",
		},
		content:
			"Testing future date handling outside data boundaries.",
	},
	{
		filename: "1944-13-45 Invalid Date Format.md",
		frontmatter: {
			daylio_event: "Should be ignored — invalid date",
		},
		content:
			"Checking scanner behavior on invalid date syntax.",
	},
	{
		filename: "1941-03-01 Antrohpic Founded.md",
		frontmatter: {
			daylio_event: "Anthropic founded",
		},
		content:
			"Duplicate date note test entry.",
	},
	{
		filename: "1941-03-01 Anthropic Founded.md",
		frontmatter: {
			daylio_event: "Anthropic founded",
		},
		content:
			"Duplicate date note test entry.",
	},
];

// ── Main Generation Routine ──────────────────────────────────────────────────
function main() {
	console.log("=== Generating Alan Turing Test Vault ===");
	console.log(`Target directory: ${vaultDir}`);

	// 1. Clean previous vault data before generating new data
	if (fs.existsSync(vaultDir)) {
		console.log(`Removing previous vault data in: ${vaultDir}`);
		fs.rmSync(vaultDir, { recursive: true, force: true });
	}

	// 2. Create directory structure
	const subdirs = [
		vaultDir,
		entriesDir,
		path.join(entriesDir, "bletchley"),
		path.join(entriesDir, "princeton"),
		path.join(entriesDir, "manchester"),
		path.join(entriesDir, "holidays"),
		attachmentsDir,
		obsidianPluginDir
	];
	subdirs.forEach((dir) => {
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
	});

	// 3. Generate Daylio CSV Export (1936-01-01 to 1954-06-07)
	const csvContent = generateCsvData("1936-01-01", "1954-06-07");
	const csvPath = path.join(attachmentsDir, "daylio_export.csv");
	fs.writeFileSync(csvPath, csvContent, "utf8");
	console.log(`Generated CSV data: ${csvPath} (${csvContent.split("\n").length - 1} entries)`);

	// 4. Generate Markdown Notes (NO tags, authentic Turing style, multiple range formats)
	let noteCount = 0;
	for (const entry of VAULT_ENTRIES) {
		const targetFolder = entry.subfolder ? path.join(entriesDir, entry.subfolder) : entriesDir;
		if (!fs.existsSync(targetFolder)) {
			fs.mkdirSync(targetFolder, { recursive: true });
		}
		const filePath = path.join(targetFolder, entry.filename);

		let frontmatterStr = "";
		if (entry.frontmatter && Object.keys(entry.frontmatter).length > 0) {
			const yamlLines = ["---"];
			for (const [key, val] of Object.entries(entry.frontmatter)) {
				if (Array.isArray(val)) {
					yamlLines.push(`${key}:`);
					for (const item of val) {
						yamlLines.push(`  - ${JSON.stringify(item)}`);
					}
				} else if (typeof val === "string") {
					yamlLines.push(`${key}: ${JSON.stringify(val)}`);
				} else {
					yamlLines.push(`${key}: ${val}`);
				}
			}
			yamlLines.push("---");
			frontmatterStr = yamlLines.join("\n") + "\n\n";
		}

		const fullNote = `${frontmatterStr}${entry.content.trim()}\n`;
		fs.writeFileSync(filePath, fullNote, "utf8");
		noteCount++;
	}

	// Non-dated notes to test filename prefix filters
	fs.writeFileSync(
		path.join(vaultDir, "Meeting Notes - Research Review.md"),
		"# Meeting Notes\n\nDiscussion on laboratory setup.",
		"utf8"
	);
	fs.writeFileSync(
		path.join(vaultDir, "Ideas and Scratchpad.md"),
		"# Ideas\n\nNotes and reflections.",
		"utf8"
	);

	console.log(`Generated ${noteCount} authentic markdown diary notes across ${entriesDir}`);

	// 5. Configure Obsidian Vault Settings
	const obsidianDir = path.join(vaultDir, ".obsidian");

	// community-plugins.json
	fs.writeFileSync(
		path.join(obsidianDir, "community-plugins.json"),
		JSON.stringify(["daylio-mood-graph"], null, 2),
		"utf8"
	);

	// app.json
	fs.writeFileSync(path.join(obsidianDir, "app.json"), "{}", "utf8");

	// core-plugins.json (enable daily notes & file explorer)
	fs.writeFileSync(
		path.join(obsidianDir, "core-plugins.json"),
		JSON.stringify(
			[
				"file-explorer",
				"global-search",
				"switcher",
				"graph",
				"backlink",
				"canvas",
				"outgoing-link",
				"tag-pane",
				"page-preview",
				"daily-notes",
				"templates",
				"note-composer",
				"command-palette",
				"markdown-importer",
				"word-count",
				"outline"
			],
			null,
			2
		),
		"utf8"
	);

	// Plugin data.json
	const pluginData = {
		csvPath: "attachments/daylio_export.csv",
		moodColors: {
			rad: "#f78c1e",
			good: "#41a766",
			meh: "#9056a3",
			bad: "#5579a7",
			awful: "#ff0000"
		},
		barWidth: 0.75,
		eventScanDir: "entries",
		showEventLabels: true
	};
	fs.writeFileSync(
		path.join(obsidianPluginDir, "data.json"),
		JSON.stringify(pluginData, null, 2),
		"utf8"
	);

	// 6. Copy built plugin files if build/ exists
	const buildDir = path.join(rootDir, "build");
	const buildFiles = ["main.js", "main.js.map"];
	const staticFiles = ["manifest.json", "styles.css"];

	for (const f of buildFiles) {
		const src = path.join(buildDir, f);
		if (fs.existsSync(src)) {
			fs.copyFileSync(src, path.join(obsidianPluginDir, f));
		}
	}
	for (const f of staticFiles) {
		const src = path.join(rootDir, f);
		if (fs.existsSync(src)) {
			fs.copyFileSync(src, path.join(obsidianPluginDir, f));
		}
	}

	console.log(`Obsidian configuration and plugin files installed to: ${obsidianPluginDir}`);
	console.log("=== Finished Alan Turing Test Vault Setup ===");
}

main();
