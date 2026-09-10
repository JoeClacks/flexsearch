// The in-memory index and the SQLite adapter must return the same order for the
// same query. Before the fix they disagreed on every multi-token query: the
// JS path ranked by max(res), the SQL by SUM(res).
global.self = global;
import { expect } from "chai";
import fs from "node:fs";
let FlexSearch = await import("../src/bundle.js");
if(FlexSearch.default) FlexSearch = FlexSearch.default;
const { Document, Charset } = FlexSearch;
const SqliteDB = (await import("../src/db/sqlite/index.js")).default;

const WORDS_A = ["honey", "roasted", "crispy", "braised", "spiced", "sticky"];
const WORDS_B = ["glazed", "charred", "whipped", "smoked", "candied"];
const WORDS_C = ["carrots", "parsnips", "aubergine", "chickpeas", "squash"];
const DOCS = [];
let s = 42;
const rnd = (n) => ((s = (s * 1103515245 + 12345) & 0x7fffffff) % n);
// `lead` is load-bearing: without it WORDS_A always sits at position 0, which
// makes max(res) and sum(res) numerically identical for a two-token query, and
// the corpus then cannot tell the two rankings apart at all.
for(let i = 0; i < 600; i++){
    const lead = Array.from({ length: rnd(5) }, (_, k) => "L" + k).join(" ");
    const pad = Array.from({ length: rnd(5) }, (_, k) => "w" + k).join(" ");
    DOCS.push({
        id: String(i),
        name: [lead, WORDS_A[rnd(6)], pad, WORDS_B[rnd(5)], WORDS_C[rnd(5)]]
            .filter(Boolean).join(" ")
    });
}

const field = () => [{
    field: "name", tokenize: "forward", resolution: 9, encoder: Charset.LatinBalance
}];
const ids = (r) => (Array.isArray(r) ? r : []).flatMap(g => g.result.map(String));

const QUERIES = [
    "honey glazed", "glazed honey", "crispy charred", "spiced candied carrots",
    "braised smoked", "sticky whipped squash", "roasted", "honey"
];

describe("in-memory / SQLite parity", function(){

    const dir = "/tmp/flexsearch-parity-test";
    let mem, sql;

    before(async function(){
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        mem = new Document({ document: { id: "id", index: field(), store: ["name"] } });
        for(const d of DOCS) mem.add(d);
        const db = new SqliteDB("parity", { path: dir + "/i.sqlite" });
        sql = new Document({ document: { id: "id", index: field(), store: ["name"] }, db, commit: false });
        await sql.mount(db);
        for(const d of DOCS) sql.add(d);
        await sql.commit();
    });

    after(function(){
        fs.rmSync(dir, { recursive: true, force: true });
    });

    for(const q of QUERIES){
        it(`agrees on "${q}"`, async function(){
            const a = ids(mem.search(q, { limit: 20 }));
            const b = ids(await sql.search(q, { limit: 20 }));
            expect(b).to.eql(a);
        });
    }

    it("agrees when the result set is truncated hard", async function(){
        const a = ids(mem.search("honey glazed", { limit: 3 }));
        const b = ids(await sql.search("honey glazed", { limit: 3 }));
        expect(b).to.eql(a);
        expect(a.length).to.equal(3);
    });
});
