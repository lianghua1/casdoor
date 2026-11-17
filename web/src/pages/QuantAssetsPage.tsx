// Copyright 2026 The Casdoor Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as React from "react";
import i18next from "i18next";
import {Search} from "lucide-react";
import {PageHeader} from "@/components/crud/PageHeader";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Input} from "@/components/ui/input";
import {ScrollArea} from "@/components/ui/scroll-area";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import * as QuantAssetsBackend from "@/backend/QuantAssetsBackend";

type UsageSummary = {calls: number; inputTokens: number; outputTokens: number; totalTokens: number};

type MinerResult = {
  steps: number;
  ensembleIc: number | null;
  rankIc: number | null;
  factors: Array<{expr: string; ic: number | null; weight: number | null}>;
};

type MinerJob = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  miningMethod: string;
  device: string;
  universe: string[];
  trainRange: string;
  errorMessage: string | null;
  result: MinerResult | null;
};

type ZooItem = {
  kind: "base" | "report" | "post";
  name: string;
  title?: string;
  updatedAt?: string;
  source: string | null;
  inputKind: string | null;
  factorCount: number | null;
  factorNames: string[] | null;
};

type ResearchFactor = {
  id: string;
  factorNumber: string;
  name: string;
  channel: string;
  symbol: string | null;
  timeframe: string | null;
  formula: string;
  createdAt: string;
};

type AiChat = {id: string; title: string; createdAt: string; updatedAt: string; messageCount: number; models: string[]};
type ChatDetail = {id: string; title: string; updatedAt: string; messages: Array<{role: string; content: string}>};

type UserAssets = {
  factors: {
    minerJobs: {total: number; byStatus: Record<string, number>; recent: MinerJob[]};
    zooImports: {total: number; recent: Array<{id: string; target: string; inputKind: string; status: string; createdAt: string}>};
    zooItems: {base: number; report: number; post: number; recent: ZooItem[]};
    researchFactors: {total: number; recent: ResearchFactor[]};
  };
  strategies: {
    versions: {total: number; recent: Array<{id: string; name: string; versionNumber: number; strategyId: string; createdAt: string}>};
    instances: {total: number; byStatus: Record<string, number>; recent: Array<{id: string; name: string; mode: string; status: string; exchange: string; symbol: string; createdAt: string}>};
    backtests: {total: number; byStatus: Record<string, number>; recent: Array<{id: string; name: string; engine: string; status: string; createdAt: string}>};
  };
  keys: {
    byok: {total: number; items: Array<{id: string; name: string; provider: string; baseUrl: string; keyLast4: string; enabled: boolean; updatedAt: string}>};
    gateway: {total: number; items: Array<{id: string; name: string; keyPrefix: string; enabled: boolean; lastUsedAt: string | null; createdAt: string}>};
    wallet: {balanceTokens: number; totalEarnedTokens: number; totalSpentTokens: number} | null;
    usage: {
      totals: UsageSummary;
      last30d: UsageSummary;
      byModel: Array<{model: string; calls: number; totalTokens: number}>;
      recent: Array<{requestId: string; model: string; upstream: string; status: string; totalTokens: number; createdAt: string}>;
    };
  };
  aiChats: {total: number; recent: AiChat[]} | null;
};

function fmtTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function fmtNumber(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString();
}

function fmtMetric(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return value.toFixed(4);
}

function ZooKindBadge({kind}: {kind: ZooItem["kind"]}) {
  const labels: Record<ZooItem["kind"], string> = {
    base: i18next.t("general:Factor base"),
    report: i18next.t("general:Report"),
    post: i18next.t("general:Post"),
  };
  const variants: Record<ZooItem["kind"], "default" | "secondary" | "outline"> = {base: "default", report: "secondary", post: "outline"};
  return <Badge variant={variants[kind]}>{labels[kind]}</Badge>;
}

function Stat({label, value}: {label: string; value: React.ReactNode}) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function StatusBadges({counts}: {counts: Record<string, number>}) {
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return <span className="text-sm text-muted-foreground">-</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([status, count]) => (
        <Badge key={status} variant="secondary">{`${status}: ${count}`}</Badge>
      ))}
    </div>
  );
}

function EmptyHint() {
  return <p className="text-sm text-muted-foreground">{i18next.t("general:No data")}</p>;
}

export default function QuantAssetsPage() {
  const [name, setName] = React.useState("");
  const [searchedName, setSearchedName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [linked, setLinked] = React.useState<boolean | null>(null);
  const [assets, setAssets] = React.useState<UserAssets | null>(null);
  const [jobDetail, setJobDetail] = React.useState<MinerJob | null>(null);
  const [chatSummary, setChatSummary] = React.useState<AiChat | null>(null);
  const [chatDetail, setChatDetail] = React.useState<ChatDetail | null>(null);
  const [chatLoading, setChatLoading] = React.useState(false);
  const [chatError, setChatError] = React.useState("");

  const search = async() => {
    const query = name.trim();
    if (query === "" || loading) {
      return;
    }
    setLoading(true);
    setError("");
    setAssets(null);
    setLinked(null);
    setSearchedName(query);
    try {
      const res = await QuantAssetsBackend.getQuantUserAssets(query);
      if (res.status !== "ok") {
        setError(res.msg || i18next.t("general:Failed to get data"));
      } else {
        setLinked(res.data?.linked === true);
        setAssets(res.data?.assets ?? null);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const openChat = async(chat: AiChat) => {
    setChatSummary(chat);
    setChatDetail(null);
    setChatError("");
    setChatLoading(true);
    try {
      const res = await QuantAssetsBackend.getQuantUserChat(searchedName, chat.id);
      if (res.status !== "ok") {
        setChatError(res.msg || i18next.t("general:Failed to get data"));
      } else {
        setChatDetail(res.data as ChatDetail);
      }
    } catch (e) {
      setChatError(String(e));
    } finally {
      setChatLoading(false);
    }
  };

  const factors = assets?.factors;
  const strategies = assets?.strategies;
  const keys = assets?.keys;
  const aiChats = assets?.aiChats ?? null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={i18next.t("general:User Assets")}
        description={i18next.t("general:User Assets - Description")}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <Input
            className="max-w-sm"
            placeholder={i18next.t("general:User Assets - Search placeholder")}
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") {
                void search();
              }
            }}
          />
          <Button onClick={() => void search()} disabled={loading || name.trim() === ""}>
            <Search className="mr-1.5 h-4 w-4" />
            {i18next.t("general:Search")}
          </Button>
        </CardContent>
      </Card>

      {error !== "" ? (
        <Card>
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {linked === false ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            {i18next.t("general:User Assets - Not linked")}
          </CardContent>
        </Card>
      ) : null}

      {linked === true && factors && strategies && keys ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{i18next.t("general:Factors")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Stat label={i18next.t("general:Mining jobs")} value={fmtNumber(factors.minerJobs.total)} />
                <Stat label={i18next.t("general:Zoo imports")} value={fmtNumber(factors.zooImports.total)} />
                <Stat label={i18next.t("general:Factor bases")} value={fmtNumber(factors.zooItems.base)} />
                <Stat label={i18next.t("general:Reports")} value={fmtNumber(factors.zooItems.report)} />
                <Stat label={i18next.t("general:Research factors")} value={fmtNumber(factors.researchFactors.total)} />
              </div>

              {factors.minerJobs.recent.length === 0 ? <EmptyHint /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{i18next.t("general:Name")}</TableHead>
                      <TableHead>{i18next.t("general:Method")}</TableHead>
                      <TableHead>{i18next.t("general:Universe")}</TableHead>
                      <TableHead>{i18next.t("general:Status")}</TableHead>
                      <TableHead>{i18next.t("general:Result factors")}</TableHead>
                      <TableHead>{i18next.t("general:Created time")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {factors.minerJobs.recent.map((job) => (
                      <TableRow
                        key={job.id}
                        className="cursor-pointer"
                        onClick={() => setJobDetail(job)}
                      >
                        <TableCell>{job.name}</TableCell>
                        <TableCell className="text-muted-foreground">{job.miningMethod}</TableCell>
                        <TableCell className="text-muted-foreground">{(job.universe ?? []).join(", ") || "-"}</TableCell>
                        <TableCell><Badge variant="secondary">{job.status}</Badge></TableCell>
                        <TableCell className="tabular-nums">
                          {job.result
                            ? `${job.result.factors.length} ${i18next.t("general:items")} · IC ${fmtMetric(job.result.ensembleIc)}`
                            : job.errorMessage ? i18next.t("general:Failed") : "-"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{fmtTime(job.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {factors.zooItems.recent.length === 0 ? <EmptyHint /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{i18next.t("general:Kind")}</TableHead>
                      <TableHead>{i18next.t("general:Name")}</TableHead>
                      <TableHead>{i18next.t("general:Factor count")}</TableHead>
                      <TableHead>{i18next.t("general:Factor names")}</TableHead>
                      <TableHead>{i18next.t("general:Updated time")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {factors.zooItems.recent.map((item) => (
                      <TableRow key={`${item.kind}-${item.name}`}>
                        <TableCell><ZooKindBadge kind={item.kind} /></TableCell>
                        <TableCell>{item.title ?? item.name}</TableCell>
                        <TableCell className="tabular-nums">{item.factorCount ?? "-"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {(item.factorNames ?? []).join(", ")}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{fmtTime(item.updatedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {factors.researchFactors.recent.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{i18next.t("general:Factor number")}</TableHead>
                      <TableHead>{i18next.t("general:Name")}</TableHead>
                      <TableHead>{i18next.t("general:Channel")}</TableHead>
                      <TableHead>{i18next.t("general:Formula")}</TableHead>
                      <TableHead>{i18next.t("general:Created time")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {factors.researchFactors.recent.map((factor) => (
                      <TableRow key={factor.id}>
                        <TableCell className="tabular-nums">{factor.factorNumber}</TableCell>
                        <TableCell>{factor.name}</TableCell>
                        <TableCell><Badge variant="outline">{factor.channel}</Badge></TableCell>
                        <TableCell className="max-w-md truncate font-mono text-xs text-muted-foreground">{factor.formula || "-"}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtTime(factor.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{i18next.t("general:Strategies")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Stat label={i18next.t("general:Versions")} value={fmtNumber(strategies.versions.total)} />
                <Stat label={i18next.t("general:Instances")} value={fmtNumber(strategies.instances.total)} />
                <Stat label={i18next.t("general:Backtests")} value={fmtNumber(strategies.backtests.total)} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">{i18next.t("general:Instances")}:</span>
                <StatusBadges counts={strategies.instances.byStatus} />
              </div>
              {strategies.versions.recent.length === 0 ? <EmptyHint /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{i18next.t("general:Name")}</TableHead>
                      <TableHead>{i18next.t("general:Version")}</TableHead>
                      <TableHead>{i18next.t("general:Created time")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {strategies.versions.recent.map((version) => (
                      <TableRow key={version.id}>
                        <TableCell>{version.name}</TableCell>
                        <TableCell>{`v${version.versionNumber}`}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtTime(version.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{i18next.t("general:AI key usage")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label={i18next.t("general:Personal AI keys")} value={fmtNumber(keys.byok.total)} />
                <Stat label={i18next.t("general:Gateway keys")} value={fmtNumber(keys.gateway.total)} />
                <Stat label={i18next.t("general:Balance tokens")} value={fmtNumber(keys.wallet?.balanceTokens)} />
                <Stat label={i18next.t("general:Spent tokens")} value={fmtNumber(keys.wallet?.totalSpentTokens)} />
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label={i18next.t("general:Calls total")} value={fmtNumber(keys.usage.totals.calls)} />
                <Stat label={i18next.t("general:Tokens total")} value={fmtNumber(keys.usage.totals.totalTokens)} />
                <Stat label={i18next.t("general:Calls last 30 days")} value={fmtNumber(keys.usage.last30d.calls)} />
                <Stat label={i18next.t("general:Tokens last 30 days")} value={fmtNumber(keys.usage.last30d.totalTokens)} />
              </div>
              {keys.byok.items.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{i18next.t("general:Personal AI keys")}</TableHead>
                      <TableHead>{i18next.t("general:Provider")}</TableHead>
                      <TableHead>{i18next.t("general:Key suffix")}</TableHead>
                      <TableHead>{i18next.t("general:Status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.byok.items.map((key) => (
                      <TableRow key={key.id}>
                        <TableCell>{key.name}</TableCell>
                        <TableCell>{key.provider}</TableCell>
                        <TableCell className="text-muted-foreground">{`****${key.keyLast4}`}</TableCell>
                        <TableCell><Badge variant={key.enabled ? "secondary" : "outline"}>{key.enabled ? "on" : "off"}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
              {keys.usage.recent.length === 0 ? <EmptyHint /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{i18next.t("general:Model")}</TableHead>
                      <TableHead>{i18next.t("general:Status")}</TableHead>
                      <TableHead>{i18next.t("general:Tokens")}</TableHead>
                      <TableHead>{i18next.t("general:Created time")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.usage.recent.map((log) => (
                      <TableRow key={log.requestId}>
                        <TableCell>{log.model}</TableCell>
                        <TableCell><Badge variant="secondary">{log.status}</Badge></TableCell>
                        <TableCell className="tabular-nums">{fmtNumber(log.totalTokens)}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtTime(log.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {aiChats ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{i18next.t("general:AI conversations")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label={i18next.t("general:Conversations")} value={fmtNumber(aiChats.total)} />
                  <Stat label={i18next.t("general:Newest update")} value={fmtTime(aiChats.recent[0]?.updatedAt)} />
                </div>
                {aiChats.recent.length === 0 ? <EmptyHint /> : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{i18next.t("general:Title")}</TableHead>
                        <TableHead>{i18next.t("general:Messages")}</TableHead>
                        <TableHead>{i18next.t("general:Models")}</TableHead>
                        <TableHead>{i18next.t("general:Updated time")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {aiChats.recent.map((chat) => (
                        <TableRow
                          key={chat.id}
                          className="cursor-pointer"
                          onClick={() => void openChat(chat)}
                        >
                          <TableCell>{chat.title || chat.id}</TableCell>
                          <TableCell className="tabular-nums">{fmtNumber(chat.messageCount)}</TableCell>
                          <TableCell className="text-muted-foreground">{(chat.models ?? []).join(", ")}</TableCell>
                          <TableCell className="text-muted-foreground">{fmtTime(chat.updatedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      <Dialog open={jobDetail !== null} onOpenChange={(open) => {
        if (!open) {
          setJobDetail(null);
        }
      }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{jobDetail?.name ?? ""}</DialogTitle>
            <DialogDescription>
              {jobDetail ? `${jobDetail.miningMethod} · ${(jobDetail.universe ?? []).join(", ")} · ${jobDetail.trainRange}` : ""}
            </DialogDescription>
          </DialogHeader>
          {jobDetail ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label={i18next.t("general:Status")} value={jobDetail.status} />
                <Stat label={i18next.t("general:Device")} value={jobDetail.device} />
                <Stat label={i18next.t("general:Steps")} value={fmtNumber(jobDetail.result?.steps)} />
                <Stat label={i18next.t("general:Ensemble IC")} value={fmtMetric(jobDetail.result?.ensembleIc)} />
              </div>
              {jobDetail.errorMessage ? (
                <p className="text-sm text-destructive">{jobDetail.errorMessage}</p>
              ) : null}
              {jobDetail.result && jobDetail.result.factors.length > 0 ? (
                <ScrollArea className="max-h-80">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{i18next.t("general:Expression")}</TableHead>
                        <TableHead>{i18next.t("general:Single IC")}</TableHead>
                        <TableHead>{i18next.t("general:Weight")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {jobDetail.result.factors.map((factor, index) => (
                        <TableRow key={`${jobDetail.id}-${index}`}>
                          <TableCell className="font-mono text-xs">{factor.expr}</TableCell>
                          <TableCell className="tabular-nums">{fmtMetric(factor.ic)}</TableCell>
                          <TableCell className="tabular-nums">{fmtMetric(factor.weight)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              ) : (
                !jobDetail.errorMessage ? <EmptyHint /> : null
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={chatSummary !== null} onOpenChange={(open) => {
        if (!open) {
          setChatSummary(null);
          setChatDetail(null);
          setChatError("");
        }
      }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{chatSummary?.title || chatSummary?.id || ""}</DialogTitle>
            <DialogDescription>
              {chatSummary ? `${fmtNumber(chatSummary.messageCount)} ${i18next.t("general:Messages")} · ${fmtTime(chatSummary.updatedAt)}` : ""}
            </DialogDescription>
          </DialogHeader>
          {chatLoading ? (
            <p className="text-sm text-muted-foreground">{i18next.t("general:Loading")}...</p>
          ) : chatError !== "" ? (
            <p className="text-sm text-destructive">{chatError}</p>
          ) : chatDetail ? (
            <ScrollArea className="max-h-96">
              <div className="flex flex-col gap-3 pr-3">
                {chatDetail.messages.length === 0 ? <EmptyHint /> : chatDetail.messages.map((message, index) => (
                  <div key={`${chatDetail.id}-${index}`} className="rounded-md border border-border p-3">
                    <Badge variant={message.role === "user" ? "secondary" : "default"}>{message.role}</Badge>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{message.content}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
