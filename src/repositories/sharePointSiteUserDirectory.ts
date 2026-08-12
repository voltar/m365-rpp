import type { SharePointClient } from "../infrastructure/microsoft365";

/**
 * EO-430: person-valued facts are stored as SharePoint `User` columns, which hold a
 * site-collection lookup id — not the Microsoft Graph user id the domain model works in.
 *
 * The Graph id is one hop away: a site user carries `UserId.NameId` (issuer
 * `urn:federation:microsoftonline`), which is the Entra object id. This directory makes that hop
 * once for the whole site instead of per row, and serves both directions:
 *
 * - reading a list item: lookup id -> Graph user id
 * - filtering a query: Graph user id -> lookup id, because OData cannot filter a person column by
 *   the Graph id
 */
export interface SharePointSiteUserDirectory {
  /** Graph user id for a person column value, or undefined when it cannot be resolved. */
  resolveGraphUserId(lookupId: number | undefined): Promise<string | undefined>;
  /** Site lookup id for a Graph user id, or undefined when the person is unknown to the site. */
  resolveLookupId(graphUserId: string): Promise<number | undefined>;
  /** Display name SharePoint renders for a person column value. */
  resolveDisplayName(lookupId: number | undefined): Promise<string | undefined>;
}

interface SharePointSiteUser {
  readonly Id?: number;
  readonly Title?: string;
  /** 1 = user. Groups also carry an object id and must not enter the map. */
  readonly PrincipalType?: number;
  readonly AadObjectId?: {
    readonly NameId?: string;
    readonly NameIdIssuer?: string;
  } | null;
}

interface SharePointSiteUserResponse {
  readonly value?: readonly SharePointSiteUser[];
}

/**
 * Only this issuer means the value is an Entra object id. Other issuers exist (on-premises
 * federation, the SharePoint system accounts) and their identifiers are something else entirely.
 */
const ENTRA_NAME_ID_ISSUER = "urn:federation:microsoftonline";

/** SharePoint principal type for a user, as opposed to a security or SharePoint group. */
const USER_PRINCIPAL_TYPE = 1;

/**
 * `AadObjectId`, not `UserId`. Verified against a live tenant on 2026-07-31: `UserId.NameId` under
 * this same issuer returned a 16-hex Microsoft Account PUID for members and nothing at all for
 * guests. It is not the Entra object id, and the issuer check is no protection — the issuer was
 * correct and the value was still wrong. `AadObjectId.NameId` carries the object id for members and
 * guests alike.
 */
const SITE_USERS_PATH =
  "/_api/web/siteusers?$select=Id,Title,PrincipalType,AadObjectId&$top=5000";

/** A Graph object id is a GUID. Anything else cannot address a Graph user. */
const GRAPH_OBJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SiteUserIndex {
  readonly graphIdByLookupId: ReadonlyMap<number, string>;
  readonly lookupIdByGraphId: ReadonlyMap<string, number>;
  readonly displayNameByLookupId: ReadonlyMap<number, string>;
}

const emptyIndex: SiteUserIndex = {
  graphIdByLookupId: new Map(),
  lookupIdByGraphId: new Map(),
  displayNameByLookupId: new Map()
};

export class FetchSharePointSiteUserDirectory implements SharePointSiteUserDirectory {
  private index?: Promise<SiteUserIndex>;

  constructor(private readonly client: SharePointClient) {}

  async resolveGraphUserId(lookupId: number | undefined): Promise<string | undefined> {
    if (lookupId === undefined) {
      return undefined;
    }

    return (await this.load()).graphIdByLookupId.get(lookupId);
  }

  async resolveLookupId(graphUserId: string): Promise<number | undefined> {
    if (!graphUserId) {
      return undefined;
    }

    return (await this.load()).lookupIdByGraphId.get(graphUserId.toLowerCase());
  }

  async resolveDisplayName(lookupId: number | undefined): Promise<string | undefined> {
    if (lookupId === undefined) {
      return undefined;
    }

    return (await this.load()).displayNameByLookupId.get(lookupId);
  }

  private load(): Promise<SiteUserIndex> {
    // One request per provider instance, shared by every concurrent caller. Without the memoised
    // promise a dashboard opening six repositories at once would issue six identical requests.
    this.index ??= this.fetchIndex();

    return this.index;
  }

  private async fetchIndex(): Promise<SiteUserIndex> {
    const result = await this.client.get<SharePointSiteUserResponse>(SITE_USERS_PATH);

    if (!result.ok) {
      // A directory that cannot be read must not fail every planning query. Rows then carry no
      // employee id and are reported as unlinkable, which is the same outcome as an unresolvable
      // person and is handled by the callers.
      return emptyIndex;
    }

    const graphIdByLookupId = new Map<number, string>();
    const lookupIdByGraphId = new Map<string, number>();
    const displayNameByLookupId = new Map<number, string>();

    (result.value.value ?? []).forEach((siteUser) => {
      if (siteUser.Id === undefined) {
        return;
      }

      if (siteUser.Title) {
        displayNameByLookupId.set(siteUser.Id, siteUser.Title);
      }

      // Groups carry an object id too — the two default SharePoint groups both report the owning
      // M365 group's id, so mapping them would make one Graph id resolve back to whichever lookup
      // id came last. Only users are people.
      if (siteUser.PrincipalType !== USER_PRINCIPAL_TYPE) {
        return;
      }

      const objectId = siteUser.AadObjectId?.NameId;
      const issuer = siteUser.AadObjectId?.NameIdIssuer;

      if (!objectId || issuer !== ENTRA_NAME_ID_ISSUER || !GRAPH_OBJECT_ID_PATTERN.test(objectId)) {
        return;
      }

      graphIdByLookupId.set(siteUser.Id, objectId);
      lookupIdByGraphId.set(objectId.toLowerCase(), siteUser.Id);
    });

    return { graphIdByLookupId, lookupIdByGraphId, displayNameByLookupId };
  }
}
