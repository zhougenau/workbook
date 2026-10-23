Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/ai-provider.ts
var AI_PROVIDERS = [{
	id: "deepseek",
	label: "DeepSeek"
}, {
	id: "qwen",
	label: "通义千问"
}];
var DEFAULT_AI_PROVIDER = "deepseek";
function isAiProvider(value) {
	return AI_PROVIDERS.some((provider) => provider.id === value);
}
function normalizeAiProvider(value) {
	return isAiProvider(value) ? value : DEFAULT_AI_PROVIDER;
}
//#endregion
//#region src/daily-review.ts
var intervals = [
	1,
	3,
	7,
	14,
	30
];
function scheduleReview(wordId, previous, remembered, now) {
	const streak = remembered ? Math.min((previous?.streak ?? 0) + 1, intervals.length) : 0;
	const intervalDays = remembered ? intervals[streak - 1] : 0;
	return {
		wordId,
		dueAt: new Date(Date.parse(now) + (remembered ? intervalDays * 864e5 : 6e5)).toISOString(),
		intervalDays,
		streak,
		lastReviewedAt: now,
		updatedAt: now
	};
}
function dueReviewWords(words, schedules, now) {
	const byId = new Map(schedules.map((schedule) => [schedule.wordId, schedule]));
	return words.filter((word) => !word.deletedAt && Date.parse(byId.get(word.id)?.dueAt ?? word.createdAt) <= Date.parse(now)).sort((left, right) => {
		const leftDue = byId.get(left.id)?.dueAt ?? left.createdAt;
		const rightDue = byId.get(right.id)?.dueAt ?? right.createdAt;
		return Date.parse(leftDue) - Date.parse(rightDue) || left.id.localeCompare(right.id);
	});
}
//#endregion
//#region src/flashcards.ts
function parseGeneratedFlashcards(value) {
	if (!value || typeof value !== "object") throw new Error("AI 返回了无法识别的卡片格式");
	const result = value;
	const usage = result.tokenUsage;
	const cards = result.cards;
	if (!Array.isArray(cards) || !cards.length || !cards.every((card) => {
		if (!card || typeof card !== "object") return false;
		const item = card;
		return typeof item.wordId === "string" && Boolean(item.wordId.trim()) && typeof item.word === "string" && Boolean(item.word.trim()) && typeof item.meaning === "string" && Boolean(item.meaning.trim()) && typeof item.usage === "string" && Boolean(item.usage.trim()) && Array.isArray(item.synonyms) && item.synonyms.every((word) => typeof word === "string" && Boolean(word.trim())) && Array.isArray(item.antonyms) && item.antonyms.every((word) => typeof word === "string" && Boolean(word.trim())) && typeof item.memoryTip === "string" && Boolean(item.memoryTip.trim());
	}) || !usage || !Number.isInteger(usage.promptTokens) || !Number.isInteger(usage.completionTokens) || !Number.isInteger(usage.totalTokens)) throw new Error("AI 返回的卡片内容不完整");
	return result;
}
function selectFlashcardWords(allWords, selectedWordIds, randomLimit = 10, random = Math.random) {
	const selected = new Set(selectedWordIds);
	if (selected.size) return allWords.filter((word) => selected.has(word.id));
	const shuffled = [...allWords];
	for (let index = shuffled.length - 1; index > 0; index -= 1) {
		const target = Math.floor(random() * (index + 1));
		const current = shuffled[index];
		shuffled[index] = shuffled[target];
		shuffled[target] = current;
	}
	const limit = Number.isFinite(randomLimit) && randomLimit > 0 ? Math.floor(randomLimit) : 10;
	return shuffled.slice(0, limit);
}
function clampFlashcardIndex(index, cardCount) {
	const lastIndex = Math.max(0, Math.floor(cardCount) - 1);
	return Math.max(0, Math.min(Number.isFinite(index) ? Math.floor(index) : 0, lastIndex));
}
//#endregion
//#region src/vocabulary.ts
var MASTERY_MIN = 0;
var MASTERY_MAX = 5;
var MAX_TERM_LENGTH = 200;
var MAX_MEANING_LENGTH = 2e3;
var MAX_NOTE_LENGTH = 4e3;
var MAX_SYNC_ENTRIES = 500;
var UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var syncStatuses = /* @__PURE__ */ new Set([
	"local",
	"pending",
	"synced",
	"conflict"
]);
function normalizeTerm(value) {
	return value.trim().toLocaleLowerCase();
}
function clampMastery(value) {
	const numeric = Number(value);
	return Math.max(0, Math.min(5, Number.isFinite(numeric) ? numeric : 0));
}
function isValidTimestamp(value) {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function isLegacyVocabularyEntry(value) {
	if (!value || typeof value !== "object") return false;
	const entry = value;
	return typeof entry.id === "string" && entry.id.length > 0 && typeof entry.term === "string" && typeof entry.meaning === "string" && typeof entry.note === "string" && Number.isInteger(entry.mastery) && Number(entry.mastery) >= 0 && Number(entry.mastery) <= 5 && isValidTimestamp(entry.createdAt) && isValidTimestamp(entry.updatedAt);
}
function isVocabularyEntry(value) {
	if (!isLegacyVocabularyEntry(value)) return false;
	const entry = value;
	return (typeof entry.ownerId === "string" || entry.ownerId === null || entry.ownerId === void 0) && (entry.deletedAt === null || isValidTimestamp(entry.deletedAt)) && syncStatuses.has(entry.syncStatus);
}
function normalizeVocabularyEntry(value, createId, now) {
	if (!value || typeof value !== "object") return null;
	const entry = value;
	if (typeof entry.id !== "string" || typeof entry.term !== "string") return null;
	const timestamp = now();
	return {
		id: UUID_V4_PATTERN.test(entry.id) ? entry.id : createId(),
		term: entry.term.trim(),
		meaning: typeof entry.meaning === "string" ? entry.meaning : "",
		note: typeof entry.note === "string" ? entry.note : "",
		mastery: clampMastery(entry.mastery),
		createdAt: isValidTimestamp(entry.createdAt) ? entry.createdAt : timestamp,
		updatedAt: isValidTimestamp(entry.updatedAt) ? entry.updatedAt : timestamp,
		ownerId: typeof entry.ownerId === "string" || entry.ownerId === null ? entry.ownerId : void 0,
		deletedAt: isValidTimestamp(entry.deletedAt) ? entry.deletedAt : null,
		syncStatus: syncStatuses.has(entry.syncStatus) ? entry.syncStatus : "local"
	};
}
function validateSyncEntry(value) {
	if (!value || typeof value !== "object") return false;
	const entry = value;
	return typeof entry.id === "string" && UUID_V4_PATTERN.test(entry.id) && typeof entry.term === "string" && entry.term.trim().length > 0 && entry.term.length <= 200 && typeof entry.meaning === "string" && entry.meaning.length <= 2e3 && typeof entry.note === "string" && entry.note.length <= 4e3 && Number.isInteger(entry.mastery) && Number(entry.mastery) >= 0 && Number(entry.mastery) <= 5 && isValidTimestamp(entry.createdAt) && isValidTimestamp(entry.updatedAt) && (entry.deletedAt === null || isValidTimestamp(entry.deletedAt));
}
//#endregion
//#region src/merge.ts
function mergeEntriesLastWriteWins(local, remote) {
	const merged = /* @__PURE__ */ new Map();
	for (const entry of local) merged.set(entry.id, entry);
	for (const entry of remote) {
		const current = merged.get(entry.id);
		if (!current || entry.updatedAt > current.updatedAt) merged.set(entry.id, entry);
	}
	return [...merged.values()];
}
function reconcileDuplicateTerms(entries, ownerId, deletedAt) {
	const keepByTerm = /* @__PURE__ */ new Map();
	for (const entry of entries) {
		if (entry.deletedAt) continue;
		const key = normalizeTerm(entry.term);
		const current = keepByTerm.get(key);
		if (!current || entry.updatedAt > current.updatedAt) keepByTerm.set(key, entry);
	}
	const keepIds = new Set([...keepByTerm.values()].map((entry) => entry.id));
	return entries.map((entry) => !entry.deletedAt && !keepIds.has(entry.id) ? {
		...entry,
		ownerId,
		deletedAt,
		updatedAt: deletedAt,
		syncStatus: "pending"
	} : entry);
}
//#endregion
//#region src/pagination.ts
var DEFAULT_PAGE_SIZE = 10;
var PAGE_SIZE_OPTIONS = [
	10,
	20,
	50
];
function positiveInteger(value, fallback) {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
function paginate(items, requestedPage, requestedPageSize) {
	const pageSize = positiveInteger(requestedPageSize, 10);
	const totalItems = items.length;
	const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
	const currentPage = Math.min(positiveInteger(requestedPage, 1), totalPages);
	const startIndex = (currentPage - 1) * pageSize;
	const endIndex = Math.min(startIndex + pageSize, totalItems);
	return {
		items: items.slice(startIndex, endIndex),
		currentPage,
		pageSize,
		totalItems,
		totalPages,
		startIndex,
		endIndex,
		firstItemNumber: totalItems === 0 ? 0 : startIndex + 1,
		lastItemNumber: endIndex
	};
}
//#endregion
//#region src/parser.ts
function extractChineseMeaning(value) {
	return value.replace(/\(([\u3400-\u9fff，、；：。！？／\s]+)\)/gu, "（$1）").match(/[\u3400-\u9fff（），、；：。！？／]+/gu)?.join("") ?? "";
}
function isLikelyEnglishExample(value) {
	return (value.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? []).length >= 3 && /[.!?][”’"']?$/.test(value.trim());
}
function analyzeVocabularyText(source) {
	const text = source.trim();
	if (!text) return null;
	const markerMatch = /(?:\*{0,2}(?:e\.?\s*g\.?|example|例句)\*{0,2})\s*[:：.]?\s*/i.exec(text);
	const allLines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	const inferredExampleIndex = markerMatch ? -1 : allLines.findIndex((line, index) => index > 0 && isLikelyEnglishExample(line));
	const beforeExample = markerMatch ? text.slice(0, markerMatch.index).trim() : inferredExampleIndex >= 0 ? allLines.slice(0, inferredExampleIndex).join("\n") : text;
	const example = markerMatch ? text.slice(markerMatch.index + markerMatch[0].length).trim() : inferredExampleIndex >= 0 ? allLines[inferredExampleIndex] : "";
	const lines = beforeExample.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	const heading = lines[0] ?? "";
	const termMatch = heading.match(/^([A-Za-z][A-Za-z'’-]*(?:[ -][A-Za-z][A-Za-z'’-]*)*)\s*(?=(?:adj|adv|noun|verb|prep|pron|conj|interj|n|v)\b|$)/i);
	const term = (termMatch?.[1] ?? heading.match(/[A-Za-z][A-Za-z'’-]*/)?.[0] ?? "").trim();
	return {
		term,
		meaning: extractChineseMeaning([heading.slice(termMatch?.[0].length ?? term.length).replace(/^(?:adj|adv|noun|verb|prep|pron|conj|interj|n|v)\.?\s*/i, "").trim(), ...lines.slice(1)].join(" ").replace(/^\/[^/\r\n]+\/\s*/, "").replace(/^(?:adj|adv|noun|verb|prep|pron|conj|interj|n|v)\.?\s*/i, "").trim()),
		example
	};
}
//#endregion
//#region src/review.ts
var difficultyWeights = {
	basic: 1,
	intermediate: 1.15,
	advanced: 1.3
};
var questionWeights = {
	meaning: 1,
	reverse: 1.1,
	cloze: 1.25,
	usage: 1.4
};
function calculateMasteryChanges(quiz, answers, words, difficulty) {
	const evidenceByWord = /* @__PURE__ */ new Map();
	quiz.questions.forEach((question, index) => {
		if (answers[index] === void 0) return;
		const result = evidenceByWord.get(question.wordId) ?? {
			evidence: 0,
			correctCount: 0,
			questionCount: 0
		};
		const weight = difficultyWeights[difficulty] * questionWeights[question.type];
		const correct = answers[index] === question.correctIndex;
		result.evidence += correct ? weight : -weight * 1.15;
		result.correctCount += correct ? 1 : 0;
		result.questionCount += 1;
		evidenceByWord.set(question.wordId, result);
	});
	return words.flatMap((word) => {
		const result = evidenceByWord.get(word.id);
		if (!result) return [];
		const delta = result.evidence >= 1.75 ? 1 : result.evidence <= -1.75 ? -1 : 0;
		const nextLevel = Math.max(0, Math.min(5, word.mastery + delta));
		return [{
			wordId: word.id,
			term: word.term,
			previousLevel: word.mastery,
			nextLevel,
			evidence: Math.round(result.evidence * 100) / 100,
			correctCount: result.correctCount,
			questionCount: result.questionCount
		}];
	});
}
//#endregion
//#region src/vocabulary-list.ts
var MASTERY_FILTER_OPTIONS = [
	"all",
	"learning",
	"0",
	"1",
	"2",
	"3",
	"4",
	"5"
];
var VOCABULARY_SORT_OPTIONS = [
	"newest",
	"oldest",
	"az",
	"mastery"
];
function filterAndSortVocabularyEntries(entries, options = {}) {
	const search = (options.search || "").trim().toLocaleLowerCase();
	const masteryFilter = options.masteryFilter || "all";
	const sort = options.sort || "newest";
	return entries.filter((entry) => {
		const matchesText = !search || [
			entry.term,
			entry.meaning,
			entry.note
		].some((value) => value.toLocaleLowerCase().includes(search));
		const matchesMastery = masteryFilter === "all" || (masteryFilter === "learning" ? entry.mastery > 0 && entry.mastery < 5 : entry.mastery === Number(masteryFilter));
		return matchesText && matchesMastery;
	}).sort((left, right) => {
		if (sort === "oldest") return left.createdAt.localeCompare(right.createdAt);
		if (sort === "az") return left.term.localeCompare(right.term);
		if (sort === "mastery") return left.mastery - right.mastery;
		return right.createdAt.localeCompare(left.createdAt);
	});
}
//#endregion
//#region src/word-chat.ts
var WORD_CHAT_SUGGESTIONS = [
	"帮我拆解词根和记忆方法",
	"给我三个不同场景的例句",
	"这个词和哪些近义词容易混淆？"
];
var MAX_WORD_CHAT_MESSAGES = 24;
var MAX_WORD_CHAT_MESSAGE_LENGTH = 2e3;
function appendWordChatQuestion(messages, question) {
	const content = question.trim();
	if (!content || content.length > 2e3) throw new Error("对话内容不正确或超过长度限制");
	return [...messages, {
		role: "user",
		content
	}].slice(-24);
}
function appendWordChatReply(messages, reply) {
	return [...messages, {
		role: "assistant",
		content: reply
	}].slice(-24);
}
function parseWordChatResponse(value) {
	if (!value || typeof value !== "object") throw new Error("AI 返回了无法识别的对话内容");
	const result = value;
	const usage = result.tokenUsage;
	if (typeof result.reply !== "string" || !result.reply.trim() || !usage || !Number.isInteger(usage.promptTokens) || !Number.isInteger(usage.completionTokens) || !Number.isInteger(usage.totalTokens)) throw new Error("AI 返回了无法识别的对话内容");
	return result;
}
//#endregion
exports.AI_PROVIDERS = AI_PROVIDERS;
exports.DEFAULT_AI_PROVIDER = DEFAULT_AI_PROVIDER;
exports.DEFAULT_PAGE_SIZE = DEFAULT_PAGE_SIZE;
exports.MASTERY_FILTER_OPTIONS = MASTERY_FILTER_OPTIONS;
exports.MASTERY_MAX = MASTERY_MAX;
exports.MASTERY_MIN = MASTERY_MIN;
exports.MAX_MEANING_LENGTH = MAX_MEANING_LENGTH;
exports.MAX_NOTE_LENGTH = MAX_NOTE_LENGTH;
exports.MAX_SYNC_ENTRIES = MAX_SYNC_ENTRIES;
exports.MAX_TERM_LENGTH = MAX_TERM_LENGTH;
exports.MAX_WORD_CHAT_MESSAGES = MAX_WORD_CHAT_MESSAGES;
exports.MAX_WORD_CHAT_MESSAGE_LENGTH = MAX_WORD_CHAT_MESSAGE_LENGTH;
exports.PAGE_SIZE_OPTIONS = PAGE_SIZE_OPTIONS;
exports.UUID_V4_PATTERN = UUID_V4_PATTERN;
exports.VOCABULARY_SORT_OPTIONS = VOCABULARY_SORT_OPTIONS;
exports.WORD_CHAT_SUGGESTIONS = WORD_CHAT_SUGGESTIONS;
exports.analyzeVocabularyText = analyzeVocabularyText;
exports.appendWordChatQuestion = appendWordChatQuestion;
exports.appendWordChatReply = appendWordChatReply;
exports.calculateMasteryChanges = calculateMasteryChanges;
exports.clampFlashcardIndex = clampFlashcardIndex;
exports.clampMastery = clampMastery;
exports.dueReviewWords = dueReviewWords;
exports.filterAndSortVocabularyEntries = filterAndSortVocabularyEntries;
exports.isAiProvider = isAiProvider;
exports.isLegacyVocabularyEntry = isLegacyVocabularyEntry;
exports.isValidTimestamp = isValidTimestamp;
exports.isVocabularyEntry = isVocabularyEntry;
exports.mergeEntriesLastWriteWins = mergeEntriesLastWriteWins;
exports.normalizeAiProvider = normalizeAiProvider;
exports.normalizeTerm = normalizeTerm;
exports.normalizeVocabularyEntry = normalizeVocabularyEntry;
exports.paginate = paginate;
exports.parseGeneratedFlashcards = parseGeneratedFlashcards;
exports.parseWordChatResponse = parseWordChatResponse;
exports.reconcileDuplicateTerms = reconcileDuplicateTerms;
exports.scheduleReview = scheduleReview;
exports.selectFlashcardWords = selectFlashcardWords;
exports.validateSyncEntry = validateSyncEntry;
