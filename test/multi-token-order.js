// Multi-token result ordering must be a function of the matched documents, not
// of loop traversal or of the order the query words were typed.
//
// Before this fix the in-memory path ranked by max(res) with ties resolved by
// traversal order, while every server-side db adapter ranked by SUM(res). The
// two disagreed on every multi-token query, and the in-memory side additionally
// reordered when the same words were typed in the other order.
//
// Both now use the same total order: max(res), then sum(res), then id.
global.self = global;
import { expect } from "chai";
let FlexSearch = await import("../src/bundle.js");
if(FlexSearch.default) FlexSearch = FlexSearch.default;
const { Document, Charset } = FlexSearch;

// X: honey@2 glazed@3 -> max 3, sum 5.  Y: honey@0 glazed@4 -> max 4, sum 4.
// max(res) ranks X first; sum(res) alone would rank Y first.
const MAXVSSUM = [
    { id: "X", name: "aa bb honey glazed cc" },
    { id: "Y", name: "honey aa bb cc glazed" }
];

// A and B tie on max(res) and on sum(res); only the id breaks them.
const TIED = [
    { id: "A", name: "honey glazed carrots" },
    { id: "B", name: "glazed honey carrots" },
    { id: "C", name: "honey and butter glazed carrots" },
    { id: "D", name: "slow roasted spiced sticky honey glazed carrots" },
    { id: "E", name: "honey roasted spiced sticky sweet glazed carrots" }
];

function build(docs){
    const doc = new Document({
        document: {
            id: "id",
            index: [{
                field: "name",
                tokenize: "forward",
                resolution: 9,
                encoder: Charset.LatinBalance
            }],
            store: ["name"]
        }
    });
    for(const d of docs) doc.add(d);
    return doc;
}

const ids = (res) => (Array.isArray(res) ? res : []).flatMap(g => g.result.map(String)).join("");

describe("Multi-token result ordering", function(){

    it("ranks by max(res), not sum(res)", function(){
        expect(ids(build(MAXVSSUM).search("honey glazed", { limit: 10 }))).to.equal("XY");
    });

    it("is invariant to the order the query words are typed", function(){
        const doc = build(TIED);
        expect(ids(doc.search("honey glazed", { limit: 10 })))
            .to.equal(ids(doc.search("glazed honey", { limit: 10 })));
    });

    it("breaks a full tie by id, so the order is total", function(){
        // A and B both match at max(res) 1 and sum(res) 1.
        const out = ids(build(TIED).search("honey glazed", { limit: 10 }));
        expect(out.indexOf("A")).to.be.below(out.indexOf("B"));
    });

    it("still applies limit after ordering, not before", function(){
        const doc = build(TIED);
        const all = ids(doc.search("honey glazed", { limit: 10 }));
        const two = ids(doc.search("honey glazed", { limit: 2 }));
        expect(two).to.equal(all.slice(0, 2));
    });

    it("leaves single-token ordering untouched", function(){
        expect(ids(build(TIED).search("honey", { limit: 10 }))).to.equal("ACEBD");
    });
});
