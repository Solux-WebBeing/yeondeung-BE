// cron_reclassify_sort_group_kst.js
require("dotenv").config();
const cron = require("node-cron");
const { Client } = require("@elastic/elasticsearch");

const es = new Client({
  node: process.env.ELASTICSEARCH_NODE || "http://localhost:9200",
});

const INDEX_OR_ALIAS = process.env.ES_INDEX_ALIAS || "boards";

// KST 기준 오늘 시작/끝을 "UTC ISO"로 만들어 ES range에 사용
function getKstTodayRangeAsUtcIso() {
  const nowUtcMs = Date.now();
  const KST_OFFSET = 9 * 60 * 60 * 1000;

  // "가짜 KST epoch"
  const kstNowMs = nowUtcMs + KST_OFFSET;

  // KST 기준 오늘 00:00:00 (ms)
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const kstTodayStartMs = kstNowMs - (kstNowMs % ONE_DAY);
  const kstTodayEndMs = kstTodayStartMs + ONE_DAY - 1;

  // 다시 UTC epoch로 환원
  const utcStartMs = kstTodayStartMs - KST_OFFSET;
  const utcEndMs = kstTodayEndMs - KST_OFFSET;

  return {
    nowIso: new Date(nowUtcMs).toISOString(),
    utcStartIso: new Date(utcStartMs).toISOString(),
    utcEndIso: new Date(utcEndMs).toISOString(),
  };
}

// 공통 스크립트: sort_group + sort_end(+ updated_at)
const buildScript = (group) => ({
  lang: "painless",
  source: `
    ctx._source.sort_group = params.group;

    // sort_end는 end_date 기준 epoch millis로 통일 (updateByQuery에서는 doc[] 사용 불가)
    if (ctx._source.containsKey('end_date') && ctx._source.end_date != null) {
      def v = ctx._source.end_date;

      // end_date가 숫자(epoch millis)인 경우
      if (v instanceof Number) {
        ctx._source.sort_end = ((Number)v).longValue();

      // end_date가 ISO 문자열(예: 2026-02-20T14:00:00.000Z)인 경우
      } else if (v instanceof String) {
        ctx._source.sort_end = java.time.Instant.parse((String)v).toEpochMilli();

      // 기타 예외 케이스는 뒤로 보냄
      } else {
        ctx._source.sort_end = 9223372036854775807L;
      }
    } else {
      ctx._source.sort_end = 9223372036854775807L; // 상시(없음)는 맨 뒤로
    }

    if (ctx._source.containsKey('updated_at')) {
      ctx._source.updated_at = params.now;
    }
  `,
  params: { group, now: new Date().toISOString() },
});

async function updateGroup({ name, query, group }) {
  try {
    const resp = await es.updateByQuery({
      index: INDEX_OR_ALIAS,
      refresh: false,              // 운영에선 보통 false
      conflicts: "proceed",
      query,
      script: buildScript(group),
    });

    console.log(
      `[${name}] updated=${resp.updated} total=${resp.total} took=${resp.took}ms`
    );
  } catch (err) {
    console.error(`[${name}] error:`, err?.meta?.body?.error || err.message);
  }
}

async function reclassifySortGroups() {
  const { nowIso, utcStartIso, utcEndIso } = getKstTodayRangeAsUtcIso();

  console.log("[range] now=", nowIso);
  console.log("[range] kstToday(UTC) start=", utcStartIso, "end=", utcEndIso);

  // 1) 상시(2): end_date 없음
  // 1) 상시(2): end_date 없음
  await updateGroup({
    name: "ALWAYS(2)",
    group: 2,
    query: {
      bool: {
        must_not: [
          { exists: { field: "end_date" } },
          { term: { sort_group: 2 } },
        ],
      },
    },
  });

  // 2) 마감(3): end_date < now
  await updateGroup({
    name: "EXPIRED(3)",
    group: 3,
    query: {
      bool: {
        filter: [
          { exists: { field: "end_date" } },
          { range: { end_date: { lt: nowIso } } },
        ],
        must_not: [{ term: { sort_group: 3 } }],
      },
    },
  });

  // 3) 오늘 마감(0): now <= end_date <= kstTodayEnd
  // (즉, 아직 안 끝났고 KST 오늘 안에 끝나는 것)
  await updateGroup({
    name: "DUE_TODAY(0)",
    group: 0,
    query: {
      bool: {
        filter: [
          { exists: { field: "end_date" } },
          { range: { end_date: { gte: nowIso, lte: utcEndIso } } },
        ],
        must_not: [{ term: { sort_group: 0 } }],
      },
    },
  });

  // 4) 미래(1): end_date > kstTodayEnd
  await updateGroup({
    name: "FUTURE(1)",
    group: 1,
    query: {
      bool: {
        filter: [
          { exists: { field: "end_date" } },
          { range: { end_date: { gt: utcEndIso } } },
        ],
        must_not: [{ term: { sort_group: 1 } }],
      },
    },
  });

  // 필요하면 마지막에 refresh (트래픽 상황 따라 선택)
  // await es.indices.refresh({ index: INDEX_OR_ALIAS });

  console.log("[done] reclassify finished");
}

// ✅ 5분마다 (원하면 "0 * * * *" 매시 정각으로)

//cron.schedule("*/5 * * * *", async () => {
//  console.log("\n[cron] start", new Date().toISOString());
//  await reclassifySortGroups();
//  console.log("[cron] end", new Date().toISOString());
//});

// 로컬에서 한번만 돌리고 종료하고 싶으면 주석 해제
 (async () => {
   await reclassifySortGroups();
   process.exit(0);
 })();
