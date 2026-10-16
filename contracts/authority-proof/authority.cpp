#include <eosio/eosio.hpp>
#include <eosio/crypto.hpp>
#include <eosio/singleton.hpp>
#include <string>
using namespace eosio;
using std::string;

// Single-runtime authority proof. Units are bounded writes, NOT RAM or money.
// No external calls, refunds, regranting, subdelegation or privileged write path.
class [[eosio::contract("vrauthority")]] vrauthority : public contract {
public:
  using contract::contract;
  struct [[eosio::table("root")]] root_row {
    name principal;
    uint64_t total;
    uint64_t available;
  };
  using root_table = singleton<"root"_n, root_row>;
  struct [[eosio::table]] grant_row {
    uint64_t id;
    name actor;
    name space;
    uint64_t budget;
    uint64_t available;
    uint64_t reserved;
    uint64_t quarantined;
    uint64_t consumed;
    uint64_t expires;
    uint32_t max_payload;
    bool revoked;
    uint64_t primary_key() const { return id; }
  };
  using grants = multi_index<"grants"_n, grant_row>;
  struct [[eosio::table]] reservation_row {
    uint64_t id;
    uint64_t grant_id;
    uint64_t obligation;
    uint64_t nullifier;
    uint64_t effect_id;
    checksum256 payload_hash;
    uint8_t status; // 0 reserved, 1 consumed, 2 quarantined; never erased
    uint64_t primary_key() const { return id; }
    uint64_t by_obligation() const { return obligation; }
    uint64_t by_nullifier() const { return nullifier; }
    uint64_t by_effect() const { return effect_id; }
  };
  using reservations = multi_index<"reservations"_n, reservation_row,
    indexed_by<"byobligation"_n, const_mem_fun<reservation_row,uint64_t,&reservation_row::by_obligation>>,
    indexed_by<"bynullifier"_n, const_mem_fun<reservation_row,uint64_t,&reservation_row::by_nullifier>>,
    indexed_by<"byeffect"_n, const_mem_fun<reservation_row,uint64_t,&reservation_row::by_effect>>>;
  struct [[eosio::table]] effect_row {
    uint64_t id;
    uint64_t reservation;
    uint64_t grant_id;
    name actor;
    name space;
    string payload;
    uint64_t primary_key() const { return id; }
  };
  using effects = multi_index<"effects"_n, effect_row>;

  [[eosio::action]] void init(name principal, uint64_t total) {
    require_auth(get_self());
    require_auth(principal);
    root_table roots(get_self(),get_self().value);
    check(!roots.exists(),"already initialized");
    check(is_account(principal),"principal account missing");
    check(total>0 && total<=10000,"root capacity out of range");
    roots.set(root_row{principal,total,total},get_self());
  }
  [[eosio::action]] void grant(uint64_t id, name actor, name space,
      uint64_t budget, uint64_t expires, uint32_t max_payload) {
    root_table roots(get_self(),get_self().value);
    auto root=roots.get();
    require_auth(root.principal);
    check(id>0 && space.value>0,"invalid grant binding");
    check(is_account(actor),"actor account missing");
    check(budget>0 && budget<=root.available,"root budget exceeded");
    check(expires>now(),"grant expired");
    check(max_payload>0 && max_payload<=256,"payload limit out of range");
    grants gs(get_self(),get_self().value);
    check(gs.find(id)==gs.end(),"grant id used");
    gs.emplace(get_self(),[&](auto& g){g={id,actor,space,budget,budget,0,0,0,expires,max_payload,false};});
    root.available-=budget;
    roots.set(root,get_self());
  }
  [[eosio::action]] void reserve(uint64_t grant_id, uint64_t id, name space,
      uint64_t obligation, uint64_t nullifier, uint64_t effect_id, checksum256 payload_hash) {
    grants gs(get_self(),get_self().value);
    const auto& g=gs.get(grant_id,"unknown grant");
    require_auth(g.actor);
    usable(g);
    check(space==g.space,"namespace mismatch");
    check(g.available>0,"grant budget exhausted");
    check(id>0 && obligation>0 && nullifier>0 && effect_id>0,"invalid reservation binding");
    reservations rs(get_self(),get_self().value);
    check(rs.find(id)==rs.end(),"reservation id used");
    auto oi=rs.get_index<"byobligation"_n>();
    auto ni=rs.get_index<"bynullifier"_n>();
    auto ei=rs.get_index<"byeffect"_n>();
    check(oi.find(obligation)==oi.end(),"obligation used");
    check(ni.find(nullifier)==ni.end(),"nullifier used");
    check(ei.find(effect_id)==ei.end(),"effect id used");
    rs.emplace(get_self(),[&](auto& r){r={id,grant_id,obligation,nullifier,effect_id,payload_hash,0};});
    gs.modify(g,same_payer,[&](auto& row){row.available--;row.reserved++;});
  }
  [[eosio::action]] void consume(uint64_t id, string payload) {
    reservations rs(get_self(),get_self().value);
    const auto& r=rs.get(id,"unknown reservation");
    grants gs(get_self(),get_self().value);
    const auto& g=gs.get(r.grant_id);
    require_auth(g.actor);
    usable(g);
    check(r.status==0,"reservation not available");
    check(!payload.empty() && payload.size()<=g.max_payload,"payload size exceeded");
    check(sha256(payload.data(),payload.size())==r.payload_hash,"payload binding mismatch");
    effects es(get_self(),get_self().value);
    check(es.find(r.effect_id)==es.end(),"effect already exists");
    // The protected effect and capacity spend are one atomic chain transition.
    es.emplace(get_self(),[&](auto& e){e={r.effect_id,r.id,g.id,g.actor,g.space,payload};});
    check(g.reserved>0,"invalid accounting");
    gs.modify(g,same_payer,[&](auto& row){row.reserved--;row.consumed++;});
    rs.modify(r,same_payer,[&](auto& row){row.status=1;});
  }
  [[eosio::action]] void revoke(uint64_t grant_id) {
    root_table roots(get_self(),get_self().value);
    require_auth(roots.get().principal);
    grants gs(get_self(),get_self().value);
    const auto& g=gs.get(grant_id,"unknown grant");
    check(!g.revoked,"already revoked");
    gs.modify(g,same_payer,[&](auto& row){row.revoked=true;});
  }
  [[eosio::action]] void quarantine(uint64_t id) {
    reservations rs(get_self(),get_self().value);
    const auto& r=rs.get(id,"unknown reservation");
    grants gs(get_self(),get_self().value);
    const auto& g=gs.get(r.grant_id);
    root_table roots(get_self(),get_self().value);
    const auto principal=roots.get().principal;
    require_auth(has_auth(principal)?principal:g.actor);
    check(r.status==0,"reservation not available");
    check(g.reserved>0,"invalid accounting");
    gs.modify(g,same_payer,[&](auto& row){row.reserved--;row.quarantined++;});
    rs.modify(r,same_payer,[&](auto& row){row.status=2;});
  }
private:
  uint64_t now() const { return current_time_point().sec_since_epoch(); }
  void usable(const grant_row& g) const {
    check(!g.revoked,"grant revoked");
    check(g.expires>now(),"grant expired");
  }
};
EOSIO_DISPATCH(vrauthority,(init)(grant)(reserve)(consume)(revoke)(quarantine))
