#include <eosio/eosio.hpp>
#include <eosio/crypto.hpp>
#include <eosio/singleton.hpp>
#include <eosio/system.hpp>

using namespace eosio;
using std::string;

// Gateway-mediated EOA authorization: this contract deliberately trusts relay.
// The gateway's EIP-712 signature is not cryptographically verified here.
class [[eosio::contract("vaultram")]] vaultram : public contract {
public:
  using contract::contract;
  struct [[eosio::table("config")]] config {
    name relayer; bool paused = false; uint32_t app_count = 0;
  };
  using configs = singleton<"config"_n, config>;
  struct [[eosio::table]] app {
    uint64_t id; checksum256 hash; uint32_t count = 0;
    uint64_t primary_key() const { return id; }
  };
  using apps = multi_index<"apps"_n, app>;
  struct [[eosio::table]] item {
    uint64_t id; string owner; uint8_t kind; uint64_t parent;
    string title; string content; string status;
    uint64_t primary_key() const { return id; }
  };
  using items = multi_index<"items"_n, item>;
  struct [[eosio::table]] nonce_row {
    uint64_t id; string owner; checksum256 owner_key; uint64_t nonce;
    checksum256 intent_hash;
    uint64_t primary_key() const { return id; }
    checksum256 by_owner() const { return owner_key; }
  };
  using nonces = multi_index<"nonces"_n, nonce_row,
    indexed_by<"byowner"_n, const_mem_fun<nonce_row, checksum256, &nonce_row::by_owner>>>;

  [[eosio::action]] void init(name relayer) {
    require_auth(get_self()); check(is_account(relayer), "relayer account missing");
    check(relayer != get_self(), "use separate runtime and relayer accounts");
    configs cfg(get_self(), get_self().value);check(!cfg.exists(), "already initialized");
    cfg.set(config{relayer, false, 0}, get_self());
  }
  [[eosio::action]] void pause(bool paused) {
    require_auth(get_self());configs cfg(get_self(), get_self().value);auto c=cfg.get();c.paused=paused;cfg.set(c,get_self());
  }
  [[eosio::action]] void regapp(uint64_t app_id, checksum256 app_hash) {
    require_auth(get_self());check(app_id>0,"invalid app id");
    configs cfg(get_self(),get_self().value);auto c=cfg.get();check(!c.paused,"runtime paused");
    apps a(get_self(),get_self().value);check(a.find(app_id)==a.end(),"app already registered");check(c.app_count<64,"app limit reached");
    a.emplace(get_self(),[&](auto& row){row.id=app_id;row.hash=app_hash;});c.app_count++;cfg.set(c,get_self());
  }
  [[eosio::action]] void execute(uint64_t app_id, checksum256 app_hash, string owner,
      checksum256 owner_key, uint64_t nonce, uint64_t expires, checksum256 intent_hash,
      uint8_t kind, uint64_t entity_id, uint64_t parent_id, string title, string content,
      string status, uint32_t ram_budget) {
    configs cfg(get_self(),get_self().value);const auto c=cfg.get();
    require_auth(permission_level{c.relayer,"relay"_n});check(!c.paused,"runtime paused");
    check(owner.size()==42 && owner.substr(0,2)=="0x","invalid owner");
    for(uint32_t i=2;i<42;i++)check((owner[i]>='0'&&owner[i]<='9')||(owner[i]>='a'&&owner[i]<='f'),"owner must be lowercase hex");
    check(owner_key==sha256(owner.data(),owner.size()),"owner key mismatch");
    const auto now=current_time_point().sec_since_epoch();check(expires>now && expires<=uint64_t(now)+300,"intent expired or lifetime too long");
    check(nonce>0 && nonce<UINT64_MAX,"invalid nonce");check(entity_id>0,"invalid entity id");check(kind<4,"unsupported action");
    check(title.size()<=80 && content.size()<=1024,"payload too large");
    check(ram_budget>=title.size()+content.size()+2048 && ram_budget<=10000,"RAM admission allowance insufficient");
    apps a(get_self(),get_self().value);const auto ap=a.require_find(app_id,"unknown app");check(ap->hash==app_hash,"app hash mismatch");
    nonces ns(get_self(),app_id);auto byowner=ns.get_index<"byowner"_n>();auto n=byowner.find(owner_key);
    if(n!=byowner.end()){check(n->owner==owner,"owner key collision");check(nonce==n->nonce+1,"nonce replay or gap");}else check(nonce==1,"first nonce must be one");
    items state(get_self(),app_id);auto existing=state.find(entity_id);
    if(kind==3){
      check(existing!=state.end() && existing->kind==0 && existing->owner==owner,"agent not owned by signer");
      check(title.empty()&&content.empty()&&parent_id==0,"unexpected status payload");check(status=="active"||status=="paused","invalid status");
      state.modify(existing,same_payer,[&](auto& row){row.status=status;});
    }else{
      check(existing==state.end(),"entity ID already exists");check(ap->count<1000,"app row limit reached");check(status=="active","initial status must be active");
      if(kind==0){check(parent_id==0,"agent cannot have parent");check(!title.empty()&&title.size()<=60&&!content.empty()&&content.size()<=500,"invalid agent fields");}
      else{auto parent=state.require_find(parent_id,"parent agent missing");check(parent->kind==0&&parent->owner==owner,"parent agent not owned by signer");if(kind==1)check(!title.empty()&&!content.empty()&&content.size()<=500,"invalid service fields");else check(title.empty()&&!content.empty(),"invalid memory fields");}
      state.emplace(c.relayer,[&](auto& row){row.id=entity_id;row.owner=owner;row.kind=kind;row.parent=parent_id;row.title=title;row.content=content;row.status="active";});
      a.modify(ap,same_payer,[&](auto& row){row.count++;});
    }
    // This write and business state change commit atomically on chain. Never delete
    // nonce rows: deleting them would permit old nonce values to be reused.
    if(n==byowner.end()){ns.emplace(c.relayer,[&](auto& row){row.id=ns.available_primary_key();row.owner=owner;row.owner_key=owner_key;row.nonce=nonce;row.intent_hash=intent_hash;});}
    else{byowner.modify(n,same_payer,[&](auto& row){row.nonce=nonce;row.intent_hash=intent_hash;});}
  }
};
EOSIO_DISPATCH(vaultram, (init)(pause)(regapp)(execute))
