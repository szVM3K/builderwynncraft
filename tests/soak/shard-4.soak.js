import { defineSoakShard } from "../harness/soak.js";

defineSoakShard(4, Number(process.env.SOAK_SHARDS || 4));
