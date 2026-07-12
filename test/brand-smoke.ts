import { checkBrand } from "../src/enrich/brand.js";
for (const d of ["paypa1-secure.info","paypal-verify.com","arnazon-support.net","secure-login-portal.com","my-bank-account.com","google.com","applepie.com"]) {
  console.log(d.padEnd(26), "->", checkBrand(d).map(e => `${e.severity}: ${e.claim.slice(0,60)}`).join("") || "clean");
}
