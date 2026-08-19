# 第 10 章：研究过程增强（可观测 · MCP · RAG）

> 故事节点：系统已能持续对话并恢复，现在让"研究过程"更深、更稳、更可控。

## 背景与动机

第 9 章打通了前后端协作——对话历史可回看、HITL 可审核、skip 可跳过。但“接口已经存在”不等于“交互已经可信”。真实联调继续暴露出四类工程问题：状态没有稳定的业务身份、事件语义混在一起、工具返回形态不统一、前端据此渲染出重复或错误的交互。

因此第 10 章先做一次**整体迁移**：保留第 9 章的 SSE、skip、回放与 PG checkpoint，参考原项目的状态机和事件契约逐项补齐；在基座稳定后，再增加可观测、MCP 与 RAG。它不是推倒重写，而是让已有功能从“能跑”走到“可解释、可恢复、可确认”。

1.  **看得见耗时**——慢节点卡在哪里，日志里一片空白。
    
2.  **接得进外部工具**——工具写死在节点里，新工具上线要改代码。
    
3.  **查得到私有知识**——只有公网搜索，组织内部规则进不了回答。
    

整体迁移完成后，本章再用三个递增量补齐耗时观测、外部工具和私有知识检索。最终目标不是堆按钮，而是建立一条可验证的研究交互链。

> **与第 9 章的关系**：第 9 章的 SSE 协议、skip 控制、回放机制全部保留。本章新增的是**横切能力**——在请求流经图节点的过程中，增加计时、外部工具和知识检索三层。

## 学习目标

### 核心增量（后端）

*   用 `@timed_node` 装饰器同时统计同步和异步节点耗时（`utils/timing.py`）。
    
*   用 Postgres 连接池 + `statement_timeout` + `connect_timeout` 建立数据库端的等待边界（`database/base.py`）。
    
*   理解 PG MVCC 为何天然读写并发，不需要 SQLite 的 WAL 补丁。
    
*   给模型调用设置超时，保留已有重试策略（`llm.py`）。
    
*   理解 MCP 三种 transport（stdio / sse / streamable\_http）和限时可降级加载器（`server/mcp_utils.py`）。
    
*   通过双层安全门（默认关闭 + agent 筛选）阻止未授权工具注入。
    
*   按 `add_to_agents` 控制 MCP 的 agent 注入范围；`enabled_tools` 当前只作为 server 启用门，工具名精确过滤属于边界项（`graph/nodes.py`）。
    
*   用 `Retriever` 抽象隔离 provider 差异（`rag/retriever.py`）。
    
*   在 researcher 中按本次开关和配置动态组合 Web/RAG 工具，保持提示词与实际工具一致（`graph/nodes.py`）。
    
*   实现 PG 持久化的配置 CRUD、资源查询与连接测试 API（`server/rag_config_service.py` + `database/` + `server/app.py`）。
    

### 拓展（前端 / 外部平台）

*   \[拓展\] 理解 observability-tab 前端设置状态同步（归前端练习，非核心后端增量）。
    
*   \[拓展\] 知道 LangSmith 配置面板的位置，但理解教程不接入真 tracing。
    

## 本章构建主线

```mermaid
flowchart TD
    A["第 9 章基座\nSSE + HITL + skip + 回放"] --> M["阶段 A：整体迁移\n状态/事件/工具/HITL 契约"]
    M --> B["阶段 B·增量① 可观测健壮性\n@timed_node + CB-2 连接池 + LLM 超时"]
    B --> C["增量② MCP 工具\n三层 transport + 限时加载 + 双层安全门"]
    C --> D["增量③ RAG 检索\nRetriever 抽象 + 内存 provider + 6 端点"]
    D --> E["完成：研究过程增强\n可观测 · 可扩展 · 可检索"]

```

先完成交互基座迁移，再递进加入三个能力增量：可观测、MCP、RAG。每一步都由一个可观察故障驱动，并有独立验收结果。

## 先看全貌

三个增量叠加到第 9 章基座后，一次研究请求的完整路径：

```text
请求 → 图节点(@timed_node 观测) → researcher(MCP 动态工具 + RAG local_search_tool) → ...
                          |
                          +-- 成功/异常都记录耗时 → [timing] researcher: 2.35s
                          |
PostgreSQL(CB-2 连接池 + statement_timeout=30s + connect_timeout=10s)
LLM(timeout=60s + max_retries=3)
MCP(load_mcp_tools → asyncio.wait_for + ImportError 兜底 → 空列表降级)
RAG(Retriever providers → 结构化结果 → human_retriever 人工确认)

```

| 主线 | 本章产物 | 验收证据 |
| --- | --- | --- |
| 节点观测 | `utils/timing.py` | `[timing] researcher: 2.35s` |
| 数据库健壮性 | `database/base.py` | `SHOW statement_timeout` → `30s` |
| 模型边界 | `llm.py` | `LLM_TIMEOUT` 可覆盖 |
| MCP 动态工具 | `server/mcp_utils.py` + `graph/nodes.py` | 加载失败返回空列表，不破坏主流程 |
| MCP 安全门 | `server/mcp_utils.py:is_mcp_enabled` | 默认关闭，开关未开返回 403 |
| RAG 检索 | `rag/` + `tools/retriever.py` | `local_search_tool` 注入 researcher |
| RAG 配置 API | `server/app.py` 6 个端点 | CRUD + 资源查询 + 连接测试 |
| 前端练习 | observability-tab 状态同步 | 改值后全局设置同步 |

---

## 0 第 9→10 章整体迁移：先让研究交互可信

### 0.1 先做差异审计，而不是直接抄最终代码

对比范围是 `tutorial/chapter09_前后端协作/code` 与本章 `code`。第 9 章已经有评估、PG checkpoint、SSE、skip 和业务事件；第 10 章新增或强化的重点如下。

| 联调时看到的问题 | 根因 | 第 10 章建立的契约 | 主要源码 |
| --- | --- | --- | --- |
| 设置页参数对执行无效 | 参数只停在 HTTP 层 | UI → `ChatRequest` → `Configuration` → graph 显式穿透 | `server/chat_request.py`、`server/app.py`、`config/configuration.py` |
| 检索只有过程，没有分值和结果 | State 没有步骤身份和待审核数据 | 用 `step`、`pending_retrieval_review` 把结果挂到当前步骤 | `graph/types.py`、`graph/nodes.py` |
| `web_search is not a valid tool` | 提示词与实际注入工具不一致 | 只根据本次实际工具生成工具说明 | `graph/nodes.py`、`prompts/researcher.md` |
| 普通文本触发 JSON 解析警告 | 工具成功与失败返回不同形态 | Web/RAG 检索统一返回结构化列表，空结果返回 `[]` | `tools/search.py`、`tools/retriever.py` |
| 点击跳过后再次出现同一次重试 | skip 被当成新执行 | 跳过当前重试，恢复最近一次完整结果，不再执行和评估 | `graph/nodes.py`、`prompts/planner_model.py` |
| 报告重写时出现“模型直接回答” | 两类人工审核复用同一事件类型 | `report_review` 与 `llm_output_review` 分离 | `graph/builder.py`、`graph/nodes.py` |
| 没有资料仍直接生成答案 | 系统没有表达“无检索依据” | 进入 `human_direct_output`，前端显示 30 秒确认 | `graph/builder.py`、`graph/nodes.py` |
| 报告混入失败尝试和旧结果 | 把过程日志当成最终事实源 | reporter 优先读取每一步最终 `execution_res` | `graph/nodes.py` |
| 刷新后知识库配置丢失 | 产品配置存在进程内存 | `RagConfig` + repository + service 使用 PG 持久化 | `database/models.py`、`database/repository.py`、`server/rag_config_service.py` |

接下来不一次性贴出最终实现，而是按故障出现的顺序逐步修复。

### 0.2 第一步：先打通请求配置

**从第 9 章出发**：聊天请求只有基础字段。即使前端提供最低分、最大重试、RAG/MCP 开关，图节点也无法读取。

**本步契约**：一次运行所需的设置必须随请求保存并显式映射，不能由节点读取浏览器状态或进程全局变量。

**增量实现**：在 `ChatRequest` 追加质量、工具、检索和报告样式字段；`server/app.py` 统一组装 `configurable`；`Configuration.from_config` 完成字段映射。

关键代码（当前 `server/app.py` 的显式字段映射）：

```python
workflow_config = {
    "configurable": {
        "thread_id": thread_id,
        "max_search_results": request.max_search_results,
        **({"min_quality_score": request.min_step_score}
           if request.min_step_score is not None else {}),
        **({"max_step_iterations": request.max_step_retry}
           if request.max_step_retry is not None else {}),
        "enable_web_search": request.enable_web_search,
        "enable_rag": request.enable_rag,

        "rag_configs": request.rag_configs if request.enable_rag else [],

        "retriever_similarity": request.retriever_similarity,
        "report_style": request.report_style,
    },
    "recursion_limit": get_recursion_limit(),
}

```

**为什么这样写**：这使同一 thread 的运行配置可复现，也避免“前端看起来改了，后端仍用默认值”。

**运行验证**：修改 `min_step_score` 或关闭 `enable_web_search`，在节点读取到的 `Configuration` 中应看到同一值。

### 0.3 第二步：给流式事件稳定身份

**失败现象**：子图启用后，事件中的临时 node 名可能是 agent；原始 `<think>` 会跨 chunk；评估、活动和正文混在消息流里。前端只能显示过程，或把内容挂错步骤。

**本步契约**：传输层只负责拆流，业务层必须拿到稳定的 `agent`、`step`、`step_title` 和事件类型。

```mermaid
flowchart LR
    A["LangGraph chunk"] --> B["namespace 还原 agent"]
    B --> C["ThinkContentParser"]
    C --> D{"事件类型"}
    D -->|正文| E["message"]
    D -->|思考| F["reasoning"]
    D -->|评分| G["evaluation_data"]
    D -->|活动| H["activity"]
    E --> I["前端 store 按 researchId/step 归并"]
    F --> I
    G --> I
    H --> I

```

**增量实现**：State 增加步骤与待审核字段；SSE 从 namespace 解析 agent；`ThinkContentParser` 处理跨 chunk 标签；`messages / updates / custom` 三路事件分别转换。

关键代码（当前 `graph/types.py` 与 `server/app.py` 的组合）：

```python
class State(MessagesState):
    step: str
    step_title: str
    param_list: list[dict]
    pending_retrieval_review: dict | None
    pending_execution_res: str | None

# metadata.langgraph_node --> agent
def _get_agent_name(agent_path, metadata) -> str:
    if agent_path:
        return str(agent_path[0]).split(":", 1)[0]  # research:<task-id>
    return (metadata or {}).get("langgraph_node", "")

```

**为什么这样写**：组件不应猜测一段字符串到底是正文、思考还是评分。先建立事件契约，才能消除重复卡片和错误 JSON 解析。

### 0.4 第三步：统一工具结果，再接 RAG

**失败现象**：成功时返回 JSON，空结果或异常时返回自然语言；前端仍调用 `parseJSON`，于是产生大量 `parsed json with extra tokens`。提示词要求 `web_search`，实际只装配了 `local_search_tool` 时又会触发 invalid tool。

**本步契约**：搜索类工具始终返回 `list[dict]`，没有结果就是空列表；提示词只声明本次实际可用的工具。

**增量实现**：`tools/search.py` 与 `tools/retriever.py` 统一结构；researcher 根据 `enable_web_search`、`enable_rag` 和实际装配结果生成工具清单；未完成的 tool call 不渲染结果卡片。

关键代码（当前 `RetrieverTool` 的真实返回契约）：

```python
class RetrieverTool(BaseTool):
    name: str = "local_search_tool"
    retrievers: list[Any] = Field(default_factory=list)
    resources: list = Field(default_factory=list)

    def _run(self, keywords: str, **kwargs) -> list[dict]:
        if not self.retrievers:

            return [ ]


        docs = [ ]

        for retriever in self.retrievers:
            docs.extend(
                retriever.query_relevant_documents(keywords, self.resources)
            )

        return [doc.to_dict() for doc in docs] if docs else [ ]


```

工具装配也由本次请求开关驱动：

```python

tools = [ ]

if configurable.enable_web_search:
    tools.extend([
        get_web_search_tool(configurable.max_search_results),
        crawl_tool,
    ])
if configurable.enable_rag and (
    configurable.resources or configurable.rag_configs
):
    retrievers = build_retriever_by_configs(
        configurable.resources,
        enabled_configs=configurable.rag_configs,
        similarity=configurable.retriever_similarity,
    )
    if retrievers:
        tools.append(make_local_search_tool(retrievers))

```

**运行验证**：关闭 Web、只开知识库时，模型不得调用 `web_search`；空结果不会再进入 JSON 容错解析，也不会出现永久 Skeleton。

### 0.5 第四步：把知识库检索变成一次人工确认

**失败现象**：检索完成后立即写报告，用户看不到查询词、阈值、文档和 chunk 分值，也无法判断是否应修改参数。

**本步契约**：`local_search_tool` 完成后先保存 `review_data`，进入 `human_retriever`；用户可以接受、修改参数后重检，或跳过知识库继续。

关键代码（researcher 先缓存结果，不立刻写入最终步骤）：

```python
retrieval_review = {
    "query": tool_args.get("keywords", ""),
    "similarity": effective_similarity,
    "documents": parsed_documents,
}
return Command(
    update={
        "current_plan": current_plan,
        "pending_retrieval_review": retrieval_review,
        "pending_execution_res": response_content,
    },
    goto="human_retriever",
)

```

审核节点只处理业务选择：接受有结果的检索、空结果转直接回答确认，其余情况回 researcher 重检。

```python
feedback = interrupt({
    "type": "retriever_review",
    "message": "请审核知识库检索结果；可接受并继续，或修改参数后重新检索。",
    "review_data": review_data,
})
if str(feedback).upper().startswith("[CONTINUE]"):
    if not review_data.get("documents"):
        return Command(goto="human_direct_output")
    current_step.execution_res = state.get("pending_execution_res") or ""
    return Command(update={"current_plan": current_plan}, goto="research_team")
return Command(goto="researcher")

```
```mermaid
stateDiagram-v2
    [*] --> Execute
    Execute --> RetrieverReview: 得到知识库结果
    RetrieverReview --> Execute: 修改查询词或阈值
    RetrieverReview --> ResearchTeam: 接受结果
    RetrieverReview --> DirectOutput: 空结果并跳过知识库
    Evaluate --> Retry: 评分不足
    Retry --> Evaluate: 重试完成
    Retry --> Restore: 跳过本轮重试
    Restore --> Reporter
    DirectOutput --> ResearchTeam: 用户确认或 30s 自动继续
    ResearchTeam --> Evaluate: 路由到待评估步骤
    ResearchTeam --> Reporter: 所有步骤完成
    Reporter --> ReportReview
    ReportReview --> Reporter: 要求重写
    ReportReview --> FinalEvaluate: 接受报告

```

**为什么这样写**：检索分值只是判断材料，不是系统替用户做出的结论。跳过知识库表示“不再用本次知识库结果”，并不等于终止任务。

### 0.6 第五步：修正评分、重试与跳过语义

**失败现象**：低分后点击“跳过”，界面又出现一次相同的“第 2 次重试”，报告还可能混入多次失败结果。

**本步契约**：skip 仅在重试阶段可用；它跳过的是**当前低分步骤的后续优化**，保留最近一次完整 `execution_res`，不新增 observation、不再调用 agent、不再评分。  

**增量实现**：低分时快照 `last_execution_res` / `last_evaluation_result`；`_finish_skipped_retry` 恢复快照并结束该步骤；SSE 检测 skip 后停止转发残余 chunk。

关键代码（当前 `planner_model.py` 与 `graph/nodes.py`）：

```python
class Step(BaseModel):
    execution_res: str | None = None
    evaluation_result: dict | None = None
    step_iterations: int = 0
    last_execution_res: str | None = None
    last_evaluation_result: dict | None = None


# eval 发现低分且仍可重试：先快照，再清空当前结果
target.last_execution_res = target.execution_res
target.last_evaluation_result = result
target.execution_res = None
target.evaluation_result = None

# skip：恢复最近完整结果，并越过重试上限
current_step.execution_res = current_step.last_execution_res
current_step.evaluation_result = current_step.last_evaluation_result
current_step.step_iterations = max(
    current_step.step_iterations,
    configurable.max_step_iterations + 1,
)
return Command(update={"current_plan": current_plan}, goto="research_team")

```

**为什么这样写**：skip 是状态迁移，不是一次工具调用。首次执行没有可恢复结果，因此不展示跳过按钮。

### 0.7 第六步：拆开两种人工审核

**失败现象**：报告要求重写时，右侧聊天栏出现“模型直接回答”。这是把两个业务中断复用了同一个前端类型。

**本步契约**：

*   `llm_output_review`：研究步骤没有 Web/RAG 工具证据，但已有模型答案；显示 30 秒倒计时，超时后按当前答案继续。
    
*   `report_review`：最终报告已经生成，用户选择接受或要求重写；不显示“模型直接回答”。
    

控制消息标记为 silent，不进入普通聊天气泡。30 秒倒计时只在真正进入 `human_direct_output` 时出现；普通检索审核、报告审核或仍有有效工具证据时都不会出现。

后端通过两个不同的 interrupt type 建立稳定协议：

```python
# human_direct_output_node：前端收到后才显示 30 秒倒计时
feedback = interrupt({
    "type": "llm_output_review",
    "message": "当前没有检索到背景知识，是否保留模型直接回答？",
})

# report_review_node：只审核报告，不触发直接回答组件
feedback = interrupt({
    "type": "report_review",
    "message": "报告已生成，请确认（[ACCEPTED] 接受 / [CONTINUE] 重新生成）",
})
if str(feedback).upper().startswith("[CONTINUE]"):
    return Command(goto="reporter")
return Command(goto="final_report_evaluator")

```

### 0.8 第七步：让报告只消费最终成果

**失败现象**：重试过程不断追加 observations，reporter 会同时看到低分旧稿和最终稿，导致报告重复或相互矛盾。

**本步契约**：过程记录用于可观测，`current_plan.steps[].execution_res` 才是每一步的最终事实源；仅在旧 checkpoint 缺少该字段时回退 observations。

同时在 `reporter → report_review → final_report_evaluator` 中加入独立报告审核，并把 `report_style` 传入 reporter。这样“重写报告”不会重跑研究步骤。

关键代码（当前 `reporter_node`）：

```python
observations = (
    [step.execution_res for step in current_plan.steps if step.execution_res]
    if isinstance(current_plan, Plan)

    else state.get("observations", [])

)
report_style = Configuration.from_config(config).report_style
if report_style:
    messages.append(HumanMessage(
        content=f"请使用用户选择的报告风格撰写：{report_style}",
        name="system",
    ))

```

### 0.9 第八步：把能力配置持久化并守住边界

RAG 配置从教学期内存 dict 升级为 PG 中的 `RagConfig`，通过 repository、service 和 API 分层管理；多个启用的 provider 可以构建多个 retriever 并合并结果。MCP 同时保留服务端总开关、字段过滤、加载超时和 agent 注入范围。

当前 builder 的完成态必须返回列表并遍历全部启用配置：

```python
def build_retriever_by_configs(
    resources: list[dict] | None = None,
    enabled_configs: list[dict] | None = None,
    similarity: float = 0.4,
    retriever_keyword: str = "",
    override_similarity: bool = False,
) -> list[Retriever]:
    if enabled_configs:

        retrievers: list[Retriever] = [ ]

        for item in enabled_configs:
            if item.get("platform") == "aihub":
                retrievers.append(AIHubProvider(
                    rag_platform_id=item.get("rag_platform_id", ""),
                    api_url=item.get("api_url", ""),
                    retrieval_size=item.get("retrieval_size", 10),
                    similarity=(similarity if override_similarity else
                                item.get("similarity", similarity)),
                ))
        return retrievers

    # 当前源码在这里把 resources 展开为 kb，再返回 [MemoryRetriever(kb)] 或 []。


    return [ ]


```
> 代码块省略了 AIHUB 凭据和内存字典展开，只为突出本步新增的列表返回、多配置循环和阈值覆盖规则；完整实现见 `code/rag/builder.py`。

这里要保持功能克制：本章不宣称迁移完整 background investigator、自动选库子图或完整 retriever-limit 状态机；界面不暴露尚未形成后端闭环的开关。

### 0.10 本轮迁移的验收方式

| 场景 | 可观察结果 |
| --- | --- |
| 只启用本地检索 | 提示词和工具列表中不出现不存在的 `web_search` |
| 检索命中/为空 | 前端展示查询参数、文档和 chunk 分值；空结果仍是结构化数据 |
| 修改检索参数 | 使用新参数重检，旧结果不被误当成已接受 |
| 低分后跳过重试 | 不产生下一次重复执行，报告保留最近完整结果 |
| 无任何工具依据 | 出现“模型直接回答”与 30 秒倒计时 |
| 报告要求重写 | 只重进 reporter，不显示“模型直接回答” |
| 页面刷新 | RAG 配置仍可从 PG 读取 |

> 本节讲的是从故障反推契约。后面的 §1～§3 再分别展开可观测、MCP 和 RAG 的实现细节。

## 1 可观测健壮性（增量① · 核心）

> 让"慢在哪里、卡在哪里"变得可判断。长流程最危险的不是明确报错，而是一直没有结果。

### 1.1 实现 `@timed_node` 同步/异步通用计时器

【目标】不改变被装饰函数的签名和返回值，只增加耗时日志。

> 文件：`code/utils/timing.py`

```python
def timed_node(func: Callable) -> Callable:
    """装饰 graph 节点（sync 或 async），统计执行耗时并记录日志。"""

    @functools.wraps(func)
    async def _async_wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            return await func(*args, **kwargs)
        finally:
            logger.info(f"[timing] {func.__name__}: {time.perf_counter() - start:.2f}s")

    @functools.wraps(func)
    def _sync_wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            return func(*args, **kwargs)
        finally:
            logger.info(f"[timing] {func.__name__}: {time.perf_counter() - start:.2f}s")

    return _async_wrapper if asyncio.iscoroutinefunction(func) else _sync_wrapper

```

**为什么这么写**

*   `perf_counter` 适合测持续时间（精度高于 `time.time`）。
    
*   `finally` 保证异常时也留下耗时日志——异常路径的耗时往往是排查关键。
    
*   `functools.wraps` 保留原函数名和元数据，图框架看到的仍是正确节点名。
    
*   `asyncio.iscoroutinefunction` 在装饰时自动分流，不需要手动指定。
    

**易错点**

*   异步包装器必须 `await func(...)`；否则 coroutine 不会执行。
    
*   不要用系统时间 `time.time()` 相减测耗时——它会被 NTP 调整干扰。
    

### 1.2 把计时能力接到关键节点

> 文件：`code/graph/nodes.py`（`researcher_node` L503、`coder_node` L525、`reporter_node` L537）

```python
@timed_node
async def researcher_node(state: State, config) -> Command:
    ...

@timed_node
async def coder_node(state: State, config) -> Command:
    ...

@timed_node
async def reporter_node(state: State, config) -> dict:
    ...

```

当前完成态签名是 `reporter_node(state, config)`，因为报告样式从 `Configuration.from_config(config).report_style` 读取；上面的装饰器示意应写为：

```python
@timed_node
async def reporter_node(state: State, config) -> dict:
    report_style = Configuration.from_config(config).report_style
    ...

```

装饰器位于最外层，图框架看到的仍是包装后的可调用对象。第 4 章已将三个节点改为 `async def`，`timed_node` 内部自动走异步分支。

### 1.3 CB-1 → CB-2：连接池加固

> 文件：`code/database/base.py`

第 8 章已将持久化切到 **Postgres（**`**postgresql+psycopg**`**）**，CB-1 最小配只有 `pool_pre_ping=True`。本章升级为 CB-2：

```python
engine = create_engine(
    DATABASE_URL,
    pool_size=int(os.getenv("DB_POOL_SIZE", "10")),           # 常驻连接数
    max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),      # 突发可溢出
    pool_recycle=int(os.getenv("DB_POOL_RECYCLE", "3600")),    # 连接回收(秒)
    pool_pre_ping=True,                                        # 借出前 ping，防已断连接
    connect_args={
        "connect_timeout": 10,                                 # 建连超时(秒)
        "options": "-c statement_timeout=30000",               # SQL 执行超时 30s，慢查询熔断
    },
)

```

**每个参数的作用**

| 参数 | 值 | 作用 |
| --- | --- | --- |
| `pool_size` | 10 | 常驻 10 条连接，覆盖普通负载 |
| `max_overflow` | 20 | 突发流量可再借 20 条（总上限 30 条） |
| `pool_recycle` | 3600 | 连接建立满 1 小时自动回收(避免评估 idle 断连（超时时间）) |
| `pool_pre_ping` | True | 借出前发 `SELECT 1` 探活，防失效连接 |
| `connect_timeout` | 10 | TCP + Postgres 握手最多等 10 秒 |
| `statement_timeout` | 30000 | PG 端给单条 SQL 30 秒上限（毫秒单位） |

**易错点**

*   `pool_size + max_overflow` 不能超过 Postgres 的 `max_connections`（默认 100）。
    
*   `statement_timeout` 单位是**毫秒**：`30000` = 30 秒；写成 `30` 会把所有请求秒杀。
    
*   `connect_timeout` 单位是**秒**（libpq 约定）；两者单位不同，别写反。
    
*   只设 `statement_timeout` 而不设 `connect_timeout`，DB 不可达时客户端会挂在 TCP 层直到操作系统超时。
    

### 1.4 PG MVCC vs SQLite WAL

| SQLite（单机文件库） | Postgres（本章使用） |
| --- | --- |
| 需要 `PRAGMA journal_mode=WAL` 才能"写不阻塞读" | **MVCC 天然读写并发**，无需 WAL 补丁 |
| `PRAGMA busy_timeout=5000`：写锁忙时等 5 秒 | 行级锁 + MVCC，读写间无写锁概念 |
| 单文件、单进程访问模式 | 多进程、多客户端并发 |
| 无 SQL 执行上限 | `**statement_timeout=30000**`：PG 端 30s 强制中止 |
| 无连接池概念 | SQLAlchemy 连接池 + `connect_timeout` 建连熔断 |

一句话：**PG 本就如此**。MVCC + `statement_timeout` + 连接池是 Postgres 的原生能力，不需要移植 SQLite 的 WAL 参数。

### 1.5 给模型调用设置超时

> 文件：`code/llm.py` L79-81

```python
# 默认重试 3 次，处理限流
merged.setdefault("max_retries", 3)
# 本章可观测增量：LLM 调用超时 60s（防卡死；生产按模型调）
merged.setdefault("timeout", int(os.getenv("LLM_TIMEOUT", "60")))

```

`setdefault` 允许配置文件显式覆盖，环境变量提供部署时调节入口。超时不是总任务截止时间；重试会增加最坏耗时，外层仍需整体预算。

### 1.6 验证

```bash
cd tutorial/chapter10_研究过程增强/code
uv run python -c "import logging; logging.basicConfig(level=logging.INFO); \
from utils.timing import timed_node; print(timed_node(lambda: 1)())"
uv run python -c "from database.base import engine; \
c=engine.raw_connection(); cur=c.cursor(); \
cur.execute('SHOW statement_timeout'); print('statement_timeout=', cur.fetchone()); \
cur.execute('SHOW server_version'); print('server_version=', cur.fetchone()); \
cur.close(); c.close()"
uv run python -m unittest discover -s tests -v

```

预期看到计时日志、`statement_timeout= ('30s',)`、Postgres 版本，以及测试通过。

---

## 2 MCP 工具（增量② · 核心）

> 把工具来源从本地静态列表扩展为受控的动态加载，并保留安全边界和来源证据。

### 2.1 三种 transport

| transport | 关键字段 | 典型边界 |
| --- | --- | --- |
| `stdio` | `command`、`args`、`env` | 可启动本地进程，风险最高 |
| `sse` | `url`、`headers` | 长连接事件流 |
| `streamable_http` | `url`、`headers` | 可流式的 HTTP 通道 |

不要把 UI 展示用字段直接转交底层客户端；运行时只保留客户端支持的键。

### 2.2 限时、可降级的工具加载器

> 文件：`code/server/mcp_utils.py`

```python
async def load_mcp_tools(mcp_servers: dict, timeout_seconds: int = 60) -> list:
    """从多个 MCP server 加载工具，返回 LangChain Tool 列表。"""
    if not mcp_servers:

        return [ ]


    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient
    except ImportError:
        logger.warning(
            "[mcp] langchain-mcp-adapters 未安装，跳过 MCP 工具加载"
            "（pip install langchain-mcp-adapters）"
        )

        return [ ]


    try:
        client = MultiServerMCPClient(mcp_servers)
        tools = await asyncio.wait_for(client.get_tools(), timeout=timeout_seconds)
        logger.info(
            f"[mcp] 从 {len(mcp_servers)} 个 MCP server 加载 {len(tools)} 个工具: "
            f"{[t.name for t in tools]}"
        )
        return tools
    except TimeoutError:
        logger.error(f"[mcp] 加载 MCP 工具超时（{timeout_seconds}s）")

        return [ ]

    except Exception as e:
        logger.error(f"[mcp] 加载 MCP 工具失败（不影响主流程）: {e}")

        return [ ]


```

**为什么这么写**

*   加载是辅助能力，**失败返回空列表，不破坏已有研究流程**。
    
*   `ImportError` 兜底——可选依赖未安装时静默降级。
    
*   `asyncio.wait_for` 给加载设时间边界；预览（15s）和正式执行（60s）可使用不同超时。
    
*   必须使用 `await`——`load_mcp_tools` 是异步函数。
    

### 2.3 双层安全门

> 文件：`code/server/mcp_utils.py` L55-61

```python
def is_mcp_enabled() -> bool:
    """ENABLE_MCP_SERVER_CONFIGURATION 双层校验（默认关）。"""
    import os
    return os.getenv("ENABLE_MCP_SERVER_CONFIGURATION", "false").lower() in (
        "true", "1", "yes", "on",
    )

```

安全门**默认关闭**。聊天入口和 metadata 入口都检查它——双层校验避免只保护执行却遗漏"预览连接"。MCP（尤其 stdio transport）可执行任意命令，不设安全门等于开放远程代码执行。

### 2.4 配置穿透：请求 → 运行时 → 图节点

`ChatRequest`（`code/server/chat_request.py` L25）新增 `mcp_settings` 字段：

```python
mcp_settings: dict = Field(default_factory=dict)

```

`Configuration`（`code/config/configuration.py` L23）从 `configurable` 中提取：

```python
mcp_settings: dict = None      # 本章 MCP 增量：MCP server 配置（动态工具加载）

```

`chat_stream` 入口（`code/server/app.py` L86-90）在请求带 MCP 配置但开关未开启时返回 403：

```python
if request.mcp_settings and not is_mcp_enabled():
    raise HTTPException(
        status_code=403,
        detail="MCP 未启用，设 ENABLE_MCP_SERVER_CONFIGURATION=true",
    )

```

### 2.5 按 agent 筛选、标注并注入工具

> 文件：`code/graph/nodes.py` L471-500 `_setup_and_execute_agent_step`

```python
async def _setup_and_execute_agent_step(state, config, agent_type, default_tools) -> Command:
    tools = list(default_tools)  # 浅拷贝，防污染默认工具列表
    configurable = Configuration.from_config(config)
    mcp_settings = configurable.mcp_settings if configurable else None
    if mcp_settings and isinstance(mcp_settings, dict) and mcp_settings.get("servers"):
        enabled_servers = {}
        for name, sc in mcp_settings["servers"].items():

            if sc.get("enabled_tools") and agent_type in sc.get("add_to_agents", []):

                enabled_servers[name] = {
                    k: v for k, v in sc.items()
                    if k in ("transport", "command", "args", "url", "env", "headers")
                }
        if enabled_servers:
            from server.mcp_utils import load_mcp_tools
            mcp_tools = await load_mcp_tools(enabled_servers)
            # 工具来源标注（审计：知道工具来自哪个 MCP server）
            for t in mcp_tools:
                src = next(
                    (n for n, s in enabled_servers.items()

                     if t.name in s.get("enabled_tools", [])),

                    "mcp",
                )
                t.description = f"Powered by '{src}'.\n{t.description}"
            tools.extend(mcp_tools)
            logger.info(f"[{agent_type}] 已加载 {len(mcp_tools)} 个 MCP 工具")

    pre_model_hook = make_context_manager_hook(agent_type)
    agent = create_agent(agent_type, agent_type, tools, agent_type, pre_model_hook)
    return await _execute_agent_step(state, agent, agent_type, config)

```

**关键设计**

*   **浅拷贝** `list(default_tools)` 阻止跨请求累积——不会"越跑越多"。
    
*   **字段白名单**只保留 transport 相关键，阻止 UI 元数据泄漏给客户端构造器。
    
*   **当前实际筛选粒度**：`enabled_tools` 非空表示启用该 server，`add_to_agents` 决定注入哪个 agent；当前加载器尚未在返回后按工具名二次过滤，不能宣称已经完成工具级白名单。
    
*   **来源标注边界**：当前连接字段过滤时不会保留 `enabled_tools`，因此描述前缀会回退为 `Powered by 'mcp'`；精确 server 来源仍是后续改造项。
    

### 2.6 真实 metadata 预览

> 文件：`code/server/app.py` L357-362

```python
@app.post("/api/mcp/server/metadata")
async def mcp_server_metadata(payload: dict):
    if not is_mcp_enabled():
        raise HTTPException(status_code=403, detail="MCP 未启用，设 ENABLE_MCP_SERVER_CONFIGURATION=true")
    connection = {
        k: v for k, v in payload.items()
        if k in ("transport", "command", "args", "url", "env", "headers")
        and v is not None
    }
    tools = await load_mcp_tools({"preview": connection}, timeout_seconds=15)
    return {
        "transport": payload.get("transport"),
        "command": payload.get("command"),
        "args": payload.get("args"),
        "url": payload.get("url"),
        "env": payload.get("env"),
        "headers": payload.get("headers"),
        "tools": [{"name": tool.name, "description": tool.description}
                  for tool in tools],

        "prompts": [],


        "resources": [],

    }

```

这是**受控的真实加载**，不是静态空数组。配置界面看到的是真实工具名和描述。预览使用更短超时（15s），避免配置界面长期等待。metadata 入口同样受安全门保护——未启用时返回 403。

### 2.7 验证

```bash
cd tutorial/chapter10_研究过程增强/code
uv run python -m unittest discover -s tests -v

```

*   不传 MCP 配置：沿用默认工具。
    
*   传配置但 `ENABLE_MCP_SERVER_CONFIGURATION` 未设：返回 403。
    
*   开关开启并安装可选依赖：metadata 返回真实加载结果。
    

---

## 3 RAG 检索（增量③ · 核心）

> 公网工具能回答通用问题，但组织内部规则必须来自私有知识资源。

> **为什么先内存 provider、再 AIHUB？** 这是教学演进，不是当前完成态同时使用两套配置仓库。先用 `MemoryRetriever` 隔离外部复杂度、讲清 `Retriever` 契约；随后换成 AIHUB 并把配置迁到 PG。当前完成态的配置以 PG 为准，内存实现仅作为中间步骤保留。

### 3.1 诚实声明：内存 provider 的定位

本节先使用**内存 provider**（`MemoryRetriever`）和进程内配置仓库作为可运行教学替身，零外部依赖演示协议；到 §3.10 会迁移为 AIHUB + PG，这才是本章完成态。

**适用场景**：教学与单进程验证。

**不宣称的能力**：持久化、多实例一致性、跨进程共享。配置仓库重启即清空，多进程之间不共享。生产应替换为数据库 + 向量检索（ES / RAGFlow 等），只需实现 `Retriever` 抽象的两个方法即可。

### 3.2 数据模型：资源 · 文档 · 片段

> 文件：`code/rag/retriever.py`

三层分离，避免 provider 私有字段进入图节点：

```python
class Chunk:
    """检索片段：内容 + 相似度。"""
    def __init__(self, content: str, similarity: float = 1.0):
        self.content = content
        self.similarity = similarity


class Document:
    """检索文档：id + 标题 + chunks。"""
    def __init__(self, id: str, title: str = "", url: str | None = None,
                 chunks: list[Chunk] | None = None, resource_title: str = "",
                 rag_platform_id: str = "", authorization: str | None = None):
        self.id = id
        self.title = title
        self.url = url

        self.chunks = chunks or [ ]

        self.resource_title = resource_title
        self.rag_platform_id = rag_platform_id
        self.authorization = authorization

    def to_dict(self) -> dict:
        d = {
            "id": self.id,
            "title": self.title,
            "content": "\n\n".join(c.content for c in self.chunks),
            "resource_title": self.resource_title,
            "rag_platform_id": self.rag_platform_id,
            "chunks": [{"content": c.content, "similarity": c.similarity}
                       for c in self.chunks],
        }
        if self.url:
            d["url"] = self.url
        if self.authorization:
            d["authorization"] = self.authorization
        return d


class Resource(BaseModel):
    """知识库资源（用户选择/检索的 KB 条目）。"""
    uri: str = Field(..., description="资源 URI（rag:// 协议）")
    title: str = Field(..., description="资源标题")
    rag_platform_id: str = Field(default="")
    description: str = Field(default="")
    tag: str = Field(default="")

```

**易错点**：资源是可选择范围，文档是一次检索返回，片段是命中内容——三者不能混为一个对象。

### 3.3 `Retriever` 抽象契约

> 文件：`code/rag/retriever.py` L59-75

```python
class Retriever(abc.ABC):
    """RAG provider 抽象：list_resources + query_relevant_documents。"""

    rag_platform_id: str = ""

    @abc.abstractmethod
    def list_resources(self, query: str | None = None) -> list[Resource]:
        """列出知识库资源。"""

    @abc.abstractmethod
    def query_relevant_documents(
        self, query: str, resources: list[Resource] | None = None
    ) -> list[Document]:
        """检索相关文档。"""

```

图和工具只依赖稳定接口。替换向量库时无需改 researcher——开闭原则。

### 3.4 内存检索实现

> 文件：`code/rag/memory.py`

```python
class MemoryRetriever(Retriever):
    """内存知识库 provider。"""

    def __init__(self, knowledge_base: dict | None = None):
        self.rag_platform_id = "memory"
        self._kb = knowledge_base or {}

    def list_resources(self, query: str | None = None) -> list[Resource]:
        return [
            Resource(uri=uri, title=kb.get("title", uri),
                     rag_platform_id="memory", description=kb.get("desc", ""))
            for uri, kb in self._kb.items()
        ]

    def query_relevant_documents(self, query: str,
                                 resources: list[Resource] | None = None) -> list[Document]:
        """关键词匹配（query 命中 chunk 内容即返回）。"""
        q = (query or "").lower().strip()
        if not q:

            return [ ]


        docs = [ ]


        target_uris = {r.uri for r in (resources or [])} or set(self._kb.keys())

        for uri in target_uris:
            kb = self._kb.get(uri)
            if not kb:
                continue
            matched = [Chunk(content=c, similarity=1.0)

                       for c in kb.get("chunks", []) if q in c.lower()]

            if matched:
                docs.append(Document(id=uri, title=kb.get("title", uri), chunks=matched,
                                    resource_title=kb.get("title", uri), rag_platform_id="memory"))
        return docs

```

这是确定性教学实现（大小写无关的子串匹配），不是语义向量检索。"没有子串命中"不等于知识库没有相关语义。

### 3.5 工具适配：`local_search_tool`

> 文件：`code/tools/retriever.py`

```python
class RetrieverTool(BaseTool):
    """local_search_tool：检索私有知识库。"""

    name: str = "local_search_tool"
    description: str = (
        "Useful for retrieving information from the file with `rag://` uri prefix, "
        "it should be higher priority than the web search or writing code. "
        "Input should be a search keywords."
    )
    args_schema: type = _LocalSearchInput
    retrievers: list[Any] = Field(default_factory=list)
    resources: list = Field(default_factory=list)

    def _run(self, keywords: str, **kwargs) -> list[dict]:
        if not self.retrievers:

            return [ ]


        docs = [ ]

        for retriever in self.retrievers:
            docs.extend(
                retriever.query_relevant_documents(keywords, self.resources)
            )

        return [doc.to_dict() for doc in docs] if docs else [ ]


```

工具的 `_run` 保持结构化契约：无配置或无结果均返回空列表。是否启用公网搜索由本次请求配置决定，RAG 工具不能擅自要求调用一个可能不存在的工具。工厂函数：

> 文件：`code/rag/builder.py`

```python
def build_retriever_by_configs(resources: list[dict] | None) -> list[Retriever]:
    if not resources:

        return [ ]

    from rag.memory import MemoryRetriever
    kb = {}
    for r in resources:
        uri = r.get("uri") or r.get("title") or ""
        if not uri:
            continue
        kb[uri] = {"title": r.get("title", uri), "desc": r.get("desc", ""),

                   "chunks": r.get("chunks", []) or []}


    return [MemoryRetriever(kb)] if kb else [ ]


```

### 3.6 researcher 动态注入 `local_search_tool`

> 文件：`code/graph/nodes.py` L503-522

```python
@timed_node
async def researcher_node(state: State, config) -> Command:
    current_plan = state.get("current_plan")
    if not isinstance(current_plan, Plan):
        return Command(goto="research_team")
    if not get_current_step(current_plan):
        return Command(goto="research_team")
    configurable = Configuration.from_config(config)

    tools = [ ]

    if configurable.enable_web_search:
        tools.extend([
            get_web_search_tool(max_results=configurable.max_search_results),
            crawl_tool,
        ])
    if configurable.enable_rag and (
        configurable.resources or configurable.rag_configs
    ):
        from rag.builder import build_retriever_by_configs
        from tools.retriever import make_local_search_tool
        retrievers = build_retriever_by_configs(
            configurable.resources,
            enabled_configs=configurable.rag_configs,
            similarity=configurable.retriever_similarity,
        )
        if retrievers:
            resources = [
                resource
                for retriever in retrievers
                for resource in retriever.list_resources()
            ]
            tools.append(make_local_search_tool(retrievers, resources))
    return await _setup_and_execute_agent_step(
        state, config, "researcher", tools
    )
    return await _setup_and_execute_agent_step(state, config, "researcher", tools)

```

**关键**：`configurable.resources` 为空时完全沿用旧工具集——有资源才构造 provider，避免空工具和额外开销。RAG 工具和 MCP 工具在 `_setup_and_execute_agent_step` 中共存，因为 researcher 先把 `local_search_tool` 加入 `tools` 列表，再交给 `_setup_and_execute_agent_step` 处理 MCP 扩展。

### 3.7 配置穿透：请求 → 运行时

`ChatRequest`（`code/server/chat_request.py` L26）新增 `resources` 字段：

```python
resources: list = Field(default_factory=list)

```

`Configuration`（`code/config/configuration.py` L24）：

```python
resources: list = None         # 本章 RAG 增量：私有知识库资源

```

`_astream_workflow_generator`（`code/server/app.py` L138）：

```python
workflow_config = {

    "configurable": {"resources": request.resources or []},

}

```

### 3.8 中间步骤：内存配置 CRUD + 6 个 RAG 端点

> 文件：`code/server/rag_config_service.py` + `code/server/app.py`

`**RAGConfigService**` 在这一中间步骤是线程安全的进程内仓库，用 `RLock` 保证并发安全，返回副本防止外部修改内部状态。它用于先固定 API 契约；§3.10.7 随后升级为 PG 持久化后端，当前源码以升级后的实现为准：

```python
class RAGConfigService:
    def __init__(self):
        self._configs: dict[str, dict] = {}
        self._lock = RLock()

    def create(self, payload: RAGConfigPayload) -> dict:
        with self._lock:
            config_id = uuid4().hex
            config = {"id": config_id, **payload.model_dump()}
            self._configs[config_id] = config
            return dict(config)

    def update(self, config_id: str, changes: dict) -> dict | None:
        with self._lock:
            current = self._configs.get(config_id)
            if current is None:
                return None
            validated = RAGConfigPayload.model_validate({**current, **changes})
            updated = {"id": config_id, **validated.model_dump()}
            self._configs[config_id] = updated
            return dict(updated)

```

**6 个 RAG API 端点**（`code/server/app.py`）：

| 端点 | 方法 | 功能 |
| --- | --- | --- |
| `/api/config/rag/get_config` | GET | 列出所有知识库配置 |
| `/api/config/rag/save_config` | POST | 新建知识库配置 |
| `/api/config/rag/{config_id}` | PUT | 更新知识库配置 |
| `/api/config/rag/{config_id}` | DELETE | 删除知识库配置 |
| `/api/config/rag/test_connection` | POST | 测试知识库连接 |
| `/api/rag/resources` | GET | 查询可用资源 |

输入模型（`code/server/rag_request.py`）：

```python
class RAGConfigPayload(BaseModel):
    name: str = Field(min_length=1)
    platform: str = Field(min_length=1)
    api_url: str = ""
    ext_config: dict[str, Any] = Field(default_factory=dict)
    retrieval_size: int = Field(default=5, ge=1, le=100)
    similarity: float = Field(default=0.5, ge=0.0, le=1.0)
    is_enabled: bool = True

```

**易错点**

*   更新必须重新经过 Pydantic 校验（`model_validate`），不能直接修改字典。
    
*   `query_resources` 只返回 `is_enabled=True` 的配置中的资源。
    
*   配置仓库重启即清空——配置与聊天 `resources` 是两条协议：请求中需显式携带资源。
    

### 3.9 验证

```bash
cd tutorial/chapter10_研究过程增强/code
uv run python -m unittest discover -s tests -v

```

通过保存接口写入带 `ext_config.resources` 的配置，再请求 `/api/rag/resources?query=...`；聊天请求需显式携带 `resources` 才会注入 `local_search_tool`。

---

## 3.10 实战拓展：接 AIHUB 知识库

> 本节是 §3 RAG 主线的**生产级拓展**——用真实知识库平台兑现 `Retriever` 抽象。内存 provider 仍是教学主线，AIHUB 是"接口不变、换一个真 provider"的实战演示。

### 3.10.1 诚实声明

在讲具体代码之前，先声明 AIHUB 集成的 5 个边界：

1.  **ddddocr 是重依赖**（OCR 验证码识别库），作为 optional extras `[aihub]` 提供（`uv run --extra aihub`）。未安装时不影响任何已有功能，AIHUB 集成测试默认 skip。
    
2.  **验证码 OCR 是生产 hack**——AIHUB 平台登录需要验证码，代码用 ddddocr 自动识别，识别失败默认返回 `"8888"`。这是 AIHUB 产品本身的认证限制，不是教学推荐模式。
    
3.  **rerank 必选**——`query_relevant_documents` 内部强制调用 `get_reranker().rerank(query, records)`，无 `RERANK_MODEL` 配置（`conf.yaml` 缺失或为空）时 AIHUB 不可用。
    
4.  **配置 PG 持久化**——`RAGConfigService` 已从进程内 dict 升级为 PG 持久化后端，重启不丢配置，但需要 PG 可用。
    
5.  **AIHUB 集成测试默认 skip**——需凭据（`AIHUB_API_URL`/`AIHUB_USERNAME`/`AIHUB_PASSWORD`）+ ddddocr，本地默认环境两个条件都不满足，全部 skip。
    

### 3.10.2 验证码登录流程

AIHUB 平台的认证需要验证码。登录分两步：先请求验证码图片，再用 OCR 识别后提交登录。

> 文件：`code/rag/aihub.py`

```python
def _parse_captcha(self, captcha_image_url: str) -> str:
    """下载验证码图片，OCR 识别，失败返回默认值 "8888"。"""
    try:
        response = requests.get(captcha_image_url, timeout=10)
        response.raise_for_status()
        ocr = _get_ocr()                     # ddddocr 懒加载
        captcha_text = ocr.classification(response.content)
        if captcha_text:
            return str(captcha_text)
        logger.warning("无法自动识别验证码，使用默认值")
        return "8888"
    except Exception as e:
        logger.error(f"验证码识别失败: {str(e)}")
        return "8888"


def _log_in(self) -> None:
    """请求验证码 → OCR 识别 → 提交登录 → 写入全局 token。"""
    response = requests.request(
        method="get",
        url=f"{self.api_url}/api/user/captcha/refresh",
        headers={"Content-Type": "application/json"},
        json={"username": self.username, "password": self.password},
    )
    result = response.json()
    captcha_hashkey = result.get("data", {}).get("captcha_hashkey")
    captcha_image_url = result.get("data", {}).get("captcha_image")
    captcha_response = self._parse_captcha(captcha_image_url)

    result = self._make_request(
        method="post",
        endpoint="/api/user/login",
        json={
            "username": self.username,
            "password": self.password,
            "captcha_hashkey": captcha_hashkey,
            "captcha_response": captcha_response,
        },
    )
    global _global_api_token, _global_token_expires_at
    with _token_lock:
        _global_api_token = result.get("data", {}).get("token")
        _global_token_expires_at = datetime.now() + timedelta(seconds=TOKEN_DURATION)

```

**关键设计**：`ddddocr` 通过 `_get_ocr()` 懒加载（L55-66），不在模块顶层 import——默认环境未装 ddddocr，只在 `uv run --extra aihub` 时首次调用才触发 import。

### 3.10.3 Token 全局缓存与 401 自动刷新

`_get_valid_token` 用双重检查 + `RLock` 管理 token 生命周期。`_make_request` 在收到 401（错误码 1002）时自动清空 token 并重试。

```python
def _get_valid_token(self) -> str:
    """获取有效 token，过期则自动刷新。"""
    global _global_api_token, _global_token_expires_at
    with _token_lock:
        now = datetime.now()
        if (
            not _global_api_token
            or not _global_token_expires_at
            or _global_token_expires_at - now >= timedelta(seconds=TOKEN_DURATION)
        ):
            if (not _global_api_token) or (not _global_token_expires_at) or (now >= _global_token_expires_at):
                self._log_in()
        return _global_api_token


def _make_request(self, method: str, endpoint: str, max_retries: int = 5, **kwargs) -> Dict[str, Any]:
    """HTTP 请求：自动加 token、401 重试、异常重试。"""
    global _global_api_token, _global_token_expires_at
    headers = kwargs.pop("headers", {})
    for attempt in range(max_retries + 1):
        try:
            if endpoint != "/api/user/login":
                token = self._get_valid_token()
                headers["Authorization"] = f"{token}"
            headers.setdefault("Content-Type", "application/json")
            response = requests.request(
                method=method,
                url=f"{self.api_url}{endpoint}",
                headers=headers,
                **kwargs,
            )
            if response.status_code == 200:
                return response.json()
            elif response.status_code == 401:
                response_data = response.json()
                if isinstance(response_data, dict) and response_data.get("code") == 1002 and attempt < max_retries:
                    with _token_lock:
                        _global_api_token = None
                        _global_token_expires_at = None
                    continue
                else:
                    return response_data
            else:
                response.raise_for_status()
        except Exception as e:
            if attempt == max_retries:
                raise Exception(f"API request failed after {max_retries} retries: {str(e)}")
            self.refresh_token()
            time.sleep(1)
    return {}

```

### 3.10.4 `list_resources`：带标签的资源列表 + 缓存

`AIHubProvider.list_resources` 默认调用 `/api/dataset`（可通过 `AIHUB_LIST_RESOURCES_API` 环境变量覆盖），返回带标签的资源列表，10 秒缓存。若部署方实际接口是 `/api/datasettag`，应通过环境变量显式配置，不能把它写成默认值。

```python
DATASET_API_PATH = os.getenv("AIHUB_LIST_RESOURCES_API", "/api/dataset")

def list_resources(self, query: str | None = None, use_cache: bool = True) -> list[Resource]:
    # 缓存逻辑：_global_resources_cache_map + _global_cache_timestamp_map + _global_cache_lock
    # 缓存 key = SHA256(api_url|username|query)，10 秒过期（RESOURCE_CACHE_DUTATION）
    # 未命中时调 _make_request(method="get", endpoint=DATASET_API_PATH, params=params)
    # 返回 Resource 对象列表（含 rag_platform_id、tag 等字段）
    ...

```

**与内存 provider 的差异**：`MemoryRetriever.list_resources` 从内存字典直接构建，`AIHubProvider.list_resources` 从远程 API 获取 + 全局缓存。两者返回相同的 `list[Resource]`——这就是 `Retriever` 抽象的价值。

### 3.10.5 `query_relevant_documents`：hit\_test 检索 + 必选 rerank

```python
def query_relevant_documents(self, query: str, resources: list[Resource] | None = None) -> list[Document]:
    query_text = self.retriever_keyword if self.retriever_keyword else query
    all_documents: dict[str, Document] = {}

    for resource in (resources or []):

        if resource.rag_platform_id != self.rag_platform_id:
            continue
        dataset_id, _ = parse_uri(resource.uri)
        result = self._make_request(
            method="get",
            endpoint=f"/api/dataset/{dataset_id}/hit_test?query_text={query_text}&..."
        )
        records = result.get("data", {})
        if not isinstance(records, list):
            continue
        # ⚠ 必选 rerank：无 RERANK_MODEL 配置时此处抛出 ValueError
        records = get_reranker().rerank(query, records)
        for record in records:
            # 按 document_id 聚合 chunks → 构造 Document 列表
            ...
    return list(all_documents.values())

```

**关键**：`get_reranker().rerank(query, records)` 是必选步骤。reranker 从 `conf.yaml` 的 `RERANK_MODEL` 配置初始化，缺少配置会抛 `ValueError`——AIHUB 不可用。

### 3.10.6 Reranker 懒加载

> 文件：`code/rag/rerank.py`

```python
_reranker_instance: DMXReranker | None = None

def get_reranker() -> DMXReranker:
    """获取 DMXReranker 单例（懒加载）。"""
    global _reranker_instance
    if _reranker_instance is None:
        _reranker_instance = DMXReranker()
    return _reranker_instance

```

`DMXReranker.__init__` 读 `conf.yaml` 的 `RERANK_MODEL` 节（`type`/`base_url`/`model`/`api_key`）。`type` 支持 `dmx`（默认，要求 base\_url+model+api\_key）和 `emb`（只要求 base\_url）。偏离主项目单 DMX 格式，但支持更多 rerank 服务。懒加载确保未配置时不影响内存 provider 的正常使用。

### 3.10.7 配置 PG 持久化升级

§3.8 的 `RAGConfigService` 已从进程内 dict + `RLock` 升级为 PG 持久化后端：

*   `server/rag_config_service.py`：接口签名不变（`list_configs`/`create`/`update`/`delete`/`query_resources`/`clear`），每个方法接收 `db: Session` 参数，委托 `database.repository` 的 5 个 PG 函数。
    
*   `database/models.py`：新增 `RagConfig` 表（`rag_configs`），字段含 `platform`（memory/aihub/...）、`ext_config`（JSON：username/password/resources/...）。
    
*   `database/repository.py`：新增 `list_rag_configs`/`create_rag_config`/`update_rag_config`/`delete_rag_config`/`query_rag_resources` 五个 PG CRUD 函数。
    
*   `server/app.py`：5 个 CRUD 端点改为 `Depends(get_db)` 注入 session（`test_rag_connection` 是 stub，不需 db）。
    
*   `server/chat_request.py`：新增 `rag_configs: list` 字段（前端携带平台配置）。
    
*   `config/configuration.py`：新增 `rag_configs: list` 字段。
    

### 3.10.8 Builder 工厂 aihub 分支

> 文件：`code/rag/builder.py`

```python
)def build_retriever_by_configs(
    resources: list[dict] | None = None,
    enabled_configs: list[dict] | None = None,
    similarity: float = 0.4,
    retriever_keyword: str = "",
) -> list[Retriever]:
    # 优先使用 enabled_configs（平台配置，如 aihub）
    if enabled_configs:

        retrievers = [ ]

        for config in enabled_configs:
            platform = config.get("platform", "")
            if platform == "aihub":
                from rag.aihub import AIHubProvider
                retrievers.append(AIHubProvider(
                    rag_platform_id=config.get("rag_platform_id", ""),
                    api_url=config.get("api_url", ""),
                    username=config.get("ext_config", {}).get("username") or "",
                    password=config.get("ext_config", {}).get("password") or "",
                    retrieval_size=config.get("retrieval_size", 10),
                    similarity=config.get("similarity", similarity),
                    retriever_keyword=config.get("retriever_keyword", retriever_keyword),
                )
        return retrievers
    # 回退到 resources（内存格式，教学主线）)
    if not resources:

        return [ ]

    # ... MemoryRetriever 构建逻辑

```

`researcher_node` 同时传入 resources 与启用的平台配置：有 `rag_configs` 时逐项构建 retriever 并合并检索，无则回退内存 provider。这里返回列表而非单例，是为了避免“只使用第一个启用知识库”的隐性丢失。

### 3.10.9 集成测试 env 门控

> 文件：`code/tests/test_aihub_integration.py`

```python
@unittest.skipUnless(
    all(os.getenv(v) for v in ("AIHUB_API_URL", "AIHUB_USERNAME", "AIHUB_PASSWORD")),
    "AIHUB 集成测试需 AIHUB_API_URL/USERNAME/PASSWORD 环境变量",
)
@unittest.skipUnless(
    _ddddocr_available(), "AIHUB 集成测试需 ddddocr（uv run --extra aihub）"
)
class AIHubIntegrationTests(unittest.TestCase):
    # test_connection: 登录 + list_resources
    # test_list_and_query: list → query 闭环
    pass

```

双重 `skipUnless` 装饰器确保本地默认环境（无凭据、无 ddddocr）全部 skip，CI 不炸。

### 3.10.10 验证

```bash
cd tutorial/chapter10_研究过程增强/code
# 单元测试（不依赖 AIHUB 凭据）
uv run python -m unittest tests/test_rag_config_api.py -v

# AIHUB 集成测试（需设 env + 安装 aihub extra）
AIHUB_API_URL=https://your-aihub AIHUB_USERNAME=xxx AIHUB_PASSWORD=xxx \
  uv run --extra aihub python -m unittest tests/test_aihub_integration.py -v

```
---

## 4 拓展与边界

### 4.1 \[拓展\] Observability-tab 前端状态同步

本章后端只新增了本地日志计时（`@timed_node`）和配置面板数据。前端 observability-tab 的 `useEffect` 状态同步属于**前端练习**，对应 `web-changes` 填空。

设置只保存在前端本地 store；它不会写环境变量，也不应宣称会直接开启后端追踪。

### 4.2 \[拓展\] LangSmith 配置面板

教程代码中有 LangSmith 配置面板的**配置入口**，但**不接入真 tracing**。真正的 LangSmith tracing 需要外部 SaaS 账号和 API key，属于生产部署范畴，不是本章验收条件。本章可独立验收的能力全部留在本地。

### 4.3 教程边界外

| 功能 | 归属 | 说明 |
| --- | --- | --- |
| `templates/upload` | 教程边界外 | 仅 CRUD 已够，沿用 ADR 0001 §五 |
| `tts` / `podcast` / `ppt` | 教程边界外 | 多模态外围，不在本章范围 |
| LangSmith 后端真实 tracing | 教程边界外 | 本章只教本地日志 + 配置面板 |
| 前端骨架 tts/podcast/ppt/prompt-enhance 按钮 | 教程边界外 | 会 404，见排障表 |
| 持久化 RAG 配置仓库 | 已实现（PG） | `RAGConfigService` 已升级为 PG 后端，`RagConfig` 表持久化 |
| 向量语义检索 | 教程边界外 | 本章用关键词匹配演示流程 |
| `checkpoint_id` 契约 | 新 ch11「研究产出加工」 | 报告导出业务需要 |

---

## 常见错误与排障

| 现象 | 根因 | 修正 |
| --- | --- | --- |
| 异常路径没有耗时日志 | 日志写在 `return` 后 | 放进 `finally` |
| 节点名变成 `wrapper` | 未使用 `functools.wraps` | 给两个包装器都加 `@functools.wraps` |
| 慢 SQL 拖垮请求 | 只设了客户端 timeout | `-c statement_timeout=30000` 让 PG 端主动熔断 |
| 拿到失效连接执行报错 | 长 idle 后连接被 PG 断开 | `pool_pre_ping=True` + `pool_recycle=3600` |
| 建连挂住数十秒 | 没设 `connect_timeout` | `connect_args={"connect_timeout": 10}` |
| `statement_timeout` 秒杀所有请求 | 单位写成 `30`（30ms） | 改为 `30000`（30 秒） |
| MCP 返回 coroutine 对象 | 忘记 `await` | `await load_mcp_tools(...)` |
| MCP 工具越跑越多 | 修改了共享默认列表 | `list(default_tools)` 浅拷贝 |
| MCP 预览绕过安全门 | 只保护聊天入口 | 两个入口都检查 `is_mcp_enabled()` |
| MCP 加载超时影响主流程 | 未做降级处理 | 加载失败返回空列表（已实现） |
| RAG 保存后聊天仍不用本地检索 | 配置仓库和聊天 `resources` 是两条协议 | 请求中显式携带资源 |
| RAG 更新绕过校验 | 直接修改字典 | 合并后重新 `model_validate` |
| RAG 候选为空被当作故障 | 尚无启用资源或查询不匹配 | 先检查配置和过滤条件 |
| 前端骨架 404（tts/podcast/ppt） | 后端未实现这些端点 | 教程边界外，不影响核心流程 |
| Turbopack 编译缓存 | Windows + 中文路径 HMR 失联 | 删除 `.next` 目录后重启 |
| MCP 加载超时是否影响 RAG | 两者在 `_setup_and_execute_agent_step` 中串联 | MCP 超时返回空列表，RAG 工具仍正常注入——互不阻塞 |
| AIHUB rerank 报 ValueError | `conf.yaml` 无 `RERANK_MODEL` 配置或 type 对应字段缺失 | 添加 `RERANK_MODEL.base_url`（必填）；dmx 需额外填 `model`/`api_key` |
| AIHUB 验证码识别失败 | ddddocr 未安装或 OCR 失败 | `uv run --extra aihub`；识别失败默认 `"8888"`（某些环境可接受） |
| AIHUB 集成测试被跳过 | 无凭据或无 ddddocr | 设 `AIHUB_API_URL`/`USERNAME`/`PASSWORD` + 安装 aihub extra |

## 本章代码结构

```text
code/
├── utils/timing.py              # 🆕 节点耗时装饰器（增量①）
├── database/base.py             # ✏️ CB-2 连接池 + statement_timeout + connect_timeout（增量①）
├── llm.py                       # ✏️ 模型超时（增量①）
├── server/mcp_utils.py          # 🆕 MCP 加载器 + 安全门（增量②）
├── server/chat_request.py       # ✏️ 新增 mcp_settings + resources 字段（增量②③）
├── config/configuration.py       # ✏️ 新增 mcp_settings + resources 字段（增量②③）
├── graph/nodes.py               # ✏️ MCP 筛选注入 + RAG 动态注入 + @timed_node（三增量）
├── rag/retriever.py             # 🆕 Retriever 抽象 + Chunk/Document/Resource 模型（增量③）
├── rag/memory.py                # 🆕 内存 provider（增量③）
├── rag/builder.py               # 🆕 provider 工厂（增量③）
├── tools/retriever.py           # 🆕 local_search_tool（增量③）
├── server/rag_request.py       # 🆕 RAG 配置输入模型（增量③）
├── server/rag_config_service.py # ✏️ PG 持久化后端（原内存 CRUD 升级）
├── rag/aihub.py                 # 🆕 AIHub 知识库 provider（实战拓展）
├── rag/rerank.py                # 🆕 Reranker 懒加载 + DMXReranker（实战拓展）
├── rag/builder.py               # ✏️ 新增 aihub 平台分支（实战拓展）
├── database/models.py           # ✏️ 新增 RagConfig 表（PG 持久化）
├── database/repository.py       # ✏️ 新增 RAG 配置 PG CRUD 5 函数
└── server/app.py                # ✏️ MCP 安全门 + metadata + 5 个 RAG 端点 PG 注入 + test_rag_connection stub
web-changes/                     # 🆕 前端填空练习

```

## 5 从第 9 章开始施工：可直接复制粘贴的完成态代码

> 前文代码块用于解释演进；如果局部片段与本节完整文件发生冲突，以本节为准。

### 5.0 跟做规则

1.  复制第 9 章 `code` 目录作为第 10 章起点。
    
2.  标注“完整覆盖”的文件：打开目标文件，全选后粘贴本节对应代码块。
    
3.  标注“新增文件”的文件：按标题给出的相对路径新建，再粘贴完整代码块。
    
4.  每完成一组就运行该组验证，不要等全部完成后一次排错。
    
5.  `uv.lock` 不手写，执行 `uv sync` 自动生成；`.env` 不复制真实账号，只从 `.env.example` 填本地值。
    

### 5.1 施工顺序与修改内容

| 步骤 | 修改内容 | 文件 |
| --- | --- | --- |
| A | 增加运行参数、RAG/MCP 开关、报告样式和 HITL resume 参数 | `server/chat_request.py`、`config/configuration.py`、`graph/types.py`、`prompts/planner_model.py` |
| B | 增加可观测活动与同步/异步计时器 | `config/activities.py`、`utils/timing.py` |
| C | 建立 RAG 数据契约、多 provider builder 和结构化工具结果 | `rag/*.py`、`tools/retriever.py` |
| D | 增加 PG RAG 配置模型、repository、service 和请求模型 | `database/models.py`、`database/repository.py`、`server/rag_*.py` |
| E | 增加 MCP 安全加载和真实 metadata | `server/mcp_utils.py`、`server/app.py` |
| F | 完成检索审核、direct-output、retry/skip、报告审核与最终事实源 | `graph/nodes.py`、`graph/builder.py` |
| G | 完成 SSE namespace、思考流、活动、评分、interrupt 和跳过分流 | `server/app.py`、`utils/think_parser.py` |
| H | 同步前端请求、Store、消息类型、检索卡片、两类审核和 skip 按钮 | `tutorial/web/src/...` |
| I | 用契约测试锁定本章边界 | `tests/test_*.py` |

> 为避免“复制一半函数还缺 import”，下面后端关键文件均采用完整文件

### 5.2 A+B：请求、状态与可观测基础

#### code/server/chat\_request.py

修改内容：完整覆盖：增加运行参数、HITL resume、RAG/MCP 与报告样式字段。

```python
"""请求模型：ChatRequest（聊天流式 + HITL resume）。"""
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class ChatRequest(BaseModel):
    """聊天流式请求。

    - messages: 对话消息 [{"role":"user","content":"..."}]
    - thread_id: 会话ID（不传则新建；HITL resume 时传回原 thread_id）
    - auto_accepted_plan: 是否跳过 HITL 计划/报告审核（默认 True 自动跑）
    - interrupt_feedback: HITL 反馈（ACCEPTED/EDIT_PLAN/CONTINUE），resume 时用
    """

    model_config = ConfigDict(extra="ignore")  # 前端骨架传超集字段，忽略未知

    messages: list[dict]
    thread_id: Optional[str] = None
    auto_accepted_plan: bool = True
    interrupt_feedback: Optional[str] = None
    plan: Optional[dict] = None
    max_plan_iterations: int = 2
    max_step_num: int = 3
    max_search_results: int = 5
    # 步骤评估阈值 & 重做上限（前端 Settings → 通用 面板的两个滑块传入）：
    # 前端字段名 min_step_score / max_step_retry，映射到后端 Configuration
    # 的 min_quality_score / max_step_iterations。默认沿用 Configuration 的默认值。
    min_step_score: Optional[float] = None
    max_step_retry: Optional[int] = None
    enable_deep_thinking: bool = False
    enable_background_investigation: bool = False
    enable_web_search: bool = False
    enable_rag: bool = True
    auto_select_kb: bool = True
    report_style: Optional[str] = None
    retriever_similarity: float = 0.4
    retriever_limit: int = 3
    param_list: list[dict] = Field(default_factory=list)
    mcp_settings: dict = Field(default_factory=dict)
    resources: list = Field(default_factory=list)
    rag_configs: list = Field(default_factory=list)


class SkipRequest(BaseModel):
    """跳过当前执行步骤的控制请求。"""

    thread_id: str

```

#### code/config/configuration.py

修改内容：完整覆盖：把请求配置映射为图节点统一读取的 Configuration。

```python
"""运行时配置：从 LangGraph 的 config 中读取可调参数。

简化自 deepResearch 的 src/config/configuration.py。
第4章新增：max_search_results（每次搜索结果数）、get_recursion_limit（ReAct 递归上限）。
后续章节会继续扩展（第6章 min_quality_score 等）。
"""
import logging
import os
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class Configuration:
    """可调参数。"""

    max_plan_iterations: int = 1   # 最大规划轮次（防止无限规划）
    max_step_num: int = 3          # 单个计划的最大步骤数
    max_search_results: int = 5    # 第4章：每次搜索返回的结果数
    max_step_iterations: int = 3   # 第6章：单个步骤的最大重做次数（低分重做上限）
    min_quality_score: float = 0.7  # 第6章：步骤质量评分阈值（低于则重做）
    mcp_settings: dict = None      # 本章 MCP 增量：MCP server 配置（动态工具加载）
    resources: list = None         # 本章 RAG 增量：私有知识库资源
    rag_configs: list = None       # RAG 平台配置列表（PG 持久化，含 platform/ext_config 等）
    enable_background_investigation: bool = False
    enable_web_search: bool = False
    enable_rag: bool = True
    auto_select_kb: bool = True
    retriever_similarity: float = 0.4
    retriever_limit: int = 3
    report_style: str | None = None

    @classmethod
    def from_config(cls, config=None) -> "Configuration":
        """从 LangGraph 的 RunnableConfig 提取配置。

        config 形如 {"configurable": {"max_plan_iterations": 1, ...}}
        """
        configurable = {}
        if config and isinstance(config, dict):
            configurable = config.get("configurable", {}) or {}
        return cls(
            max_plan_iterations=int(configurable.get("max_plan_iterations", 1)),
            max_step_num=int(configurable.get("max_step_num", 3)),
            max_search_results=int(configurable.get("max_search_results", 5)),
            max_step_iterations=int(configurable.get("max_step_iterations", 3)),
            min_quality_score=float(configurable.get("min_quality_score", 0.7)),
            mcp_settings=configurable.get("mcp_settings"),
            resources=configurable.get("resources"),
            rag_configs=configurable.get("rag_configs"),
            enable_background_investigation=bool(
                configurable.get("enable_background_investigation", False)
            ),
            enable_web_search=bool(configurable.get("enable_web_search", False)),
            enable_rag=bool(configurable.get("enable_rag", True)),
            auto_select_kb=bool(configurable.get("auto_select_kb", True)),
            retriever_similarity=float(
                configurable.get("retriever_similarity", 0.4)
            ),
            retriever_limit=int(configurable.get("retriever_limit", 3)),
            report_style=configurable.get("report_style"),
        )


def get_recursion_limit(default: int = 25) -> int:
    """从环境变量 AGENT_RECURSION_LIMIT 读取 ReAct 递归上限。

    ReAct agent 在"思考→工具→观察"之间循环，recursion_limit 限制图的最大步数，
    防止 agent 陷入无限循环（这是图步数上限，不是 LLM 调用次数）。
    """
    raw = os.getenv("AGENT_RECURSION_LIMIT", str(default))
    try:
        val = int(raw)
        if val > 0:
            return val
        logger.warning(
            f"AGENT_RECURSION_LIMIT 值 '{raw}' 非正数，使用默认 {default}"
        )
    except (ValueError, TypeError):
        logger.warning(f"AGENT_RECURSION_LIMIT 值 '{raw}' 非法，使用默认 {default}")
    return default

```

#### code/graph/types.py

修改内容：完整覆盖：增加步骤身份、检索待审核状态和直接回答缓存。

```python
"""State 定义：贯穿整个研究流程的状态模式。

继承 MessagesState → messages 字段自带 add reducer（多节点返回的 messages 会自动累加）。
其他字段默认 last-write-wins（后写覆盖前写）。

第2章新增：current_plan / plan_iterations / auto_accepted_plan。
"""
from typing import Annotated

from langgraph.graph import MessagesState

from prompts.planner_model import EvaluationRecord, Plan


def add_list(left: list | None, right: list | None) -> list:
    """列表累加 reducer：用于需要跨节点累积的字段（如 observations）。"""

    return (left or []) + (right or [])



class State(MessagesState):
    """deepresearch 系统的全局状态。"""

    # —— 第1章字段 ——
    locale: str
    research_topic: str
    observations: Annotated[list[str], add_list]
    final_report: str

    # —— 第2章新增 ——
    # 当前研究计划（planner 写入 Plan 对象）
    current_plan: Plan | str | None
    # 规划轮次计数（防止无限规划）
    plan_iterations: int
    # 是否跳过 HITL 计划审核（第2章恒 True，第5章引入真正的 interrupt）
    auto_accepted_plan: bool

    # —— 第5章新增 ——
    # 用户内联编辑的计划（前端回灌；human_feedback_node 用 _merge_plan_edits 合并）
    edited_plan: dict | None

    # —— 第6章新增 ——
    # 评估历史（每个研究步骤 + 终评的记录）
    evaluation_history: Annotated[list[EvaluationRecord], add_list]
    # 最终报告评估结果
    final_report_evaluation: dict | None
    # 当前正在执行的步骤标识（researcher/coder 每步开始时写入，
    # server/_process_message_chunk 读它决定 base.step / step_title，
    # 前端 research-activities-block 按 step 分组渲染，缺失时 eval 卡片渲染位置错乱）
    step: str
    step_title: str
    # 检索审核：前端修改检索参数后随 HITL resume 回灌。
    param_list: list[dict]
    pending_retrieval_review: dict | None
    pending_execution_res: str | None

```

#### code/prompts/planner\_model.py

修改内容：完整覆盖：给 Step 增加低分结果与评分快照。

```python
"""Plan / Step 数据模型（Pydantic）。

简化自 deepResearch 的 src/prompts/planner_model.py。
planner 用这些模型约束 LLM 输出结构化的研究计划。
"""
from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class StepType(str, Enum):
    """步骤类型。第2章只用 RESEARCH；PROCESSING（代码处理）第3章加 coder 后用。"""
    RESEARCH = "research"        # 需要搜索/检索的研究步骤
    PROCESSING = "processing"    # 需要代码处理的数据步骤


class Step(BaseModel):
    """单个研究步骤。"""
    need_search: bool = Field(..., description="该步骤是否需要搜索")
    title: str = Field(..., description="步骤标题")
    description: str = Field(..., description="明确要收集什么数据/信息")
    step_type: StepType = Field(..., description="步骤类型")
    # 以下字段由 researcher/eval 写入，planner 不填
    execution_res: Optional[str] = Field(default=None, description="步骤执行结果")
    evaluation_result: Optional[dict[Any, Any]] = Field(default=None, description="步骤评估结果（第6章 eval 写入）")
    step_iterations: int = Field(default=0, description="步骤重做次数（第6章 eval 递增，低分重做上限）")
    # 低分进入重试前保存最近一次完整结果；用户跳过重试时恢复它并继续后续步骤。
    last_execution_res: Optional[str] = Field(default=None, description="最近一次低分但可用的执行结果")
    last_evaluation_result: Optional[dict[Any, Any]] = Field(default=None, description="最近一次执行结果对应的评估")


class Plan(BaseModel):
    """完整研究计划。"""
    locale: str = Field(..., description="用户语言，如 zh-CN / en-US")
    has_enough_context: bool = Field(..., description="上下文是否已足够（true 则跳过研究直接报告）")
    thought: str = Field(default="", description="规划思路")
    title: str = Field(..., description="计划标题")
    steps: list[Step] = Field(default_factory=list, description="研究步骤列表")


# —— basic 模式用的最小版（with_structured_output 时用，字段更少更稳定）——
class StepMinimal(BaseModel):
    need_search: bool
    title: str
    description: str
    step_type: StepType


class PlanMinimal(BaseModel):
    locale: str
    has_enough_context: bool
    thought: str = ""
    title: str

    steps: list[StepMinimal] = [ ]



# —— 第6章新增：评估模型 ——


class EvaluationResponse(BaseModel):
    """评估响应（LLM structured_output 用）：质量评分 + 反馈。"""

    quality_score: float = Field(..., description="质量评分 0.0-1.0")
    feedback: str = Field(default="无具体反馈", description="评估反馈，markdown")


class EvaluationRecord(BaseModel):
    """评估记录（写入 evaluation_history）。"""

    step_title: str = Field(..., description="被评估步骤标题")
    step_type: str = Field(default="research", description="步骤类型")
    quality_score: float = Field(..., description="质量评分 0.0-1.0")
    feedback: str = Field(default="", description="评估反馈")
    evaluation_timestamp: datetime = Field(default_factory=datetime.now, description="评估时间")
    evaluator_name: str = Field(default="evaluator", description="评估者")

```

#### code/config/activities.py

修改内容：新增文件：定义前端可展示的业务活动类型。

```python
"""前端研究过程卡片使用的活动类型。"""
from enum import Enum
from typing import NamedTuple


class ActivityField(NamedTuple):
    type: str
    description: str


class ActivityType(Enum):
    """与原项目及前端 activity 展示契约保持一致。"""

    RECOGNIZE_KNOWY = ActivityField("recognize_knowy", "识别知识库")
    EXECUTE_RESEARCH = ActivityField("execute_research", "执行研究")
    RESEARCH_REPORT = ActivityField("research_report", "研究结果")
    EVALUATE_RESEARCH = ActivityField("evaluate_research", "评估研究结果")

    @property
    def type(self) -> str:
        return self._value_.type

    @property
    def description(self) -> str:
        return self._value_.description

```

#### code/utils/timing.py

修改内容：新增文件：同步/异步节点共用的计时装饰器。

```python
"""节点耗时装饰器：横切统计每个 graph 节点的执行时间（业务可观测）。

本章可观测增量：除 LangSmith（SaaS 追踪）外，业务侧用本装饰器记录每节点耗时，
无需外部依赖即可定位慢节点（生产 80% 性能问题来自某个慢节点）。
"""
import asyncio
import functools
import logging
import time
from typing import Callable

logger = logging.getLogger(__name__)


def timed_node(func: Callable) -> Callable:
    """装饰 graph 节点（sync 或 async），统计执行耗时并记录日志。

    用法：在节点函数上加 @timed_node（注意：LangGraph 节点装饰器要在最外层）。
    """

    @functools.wraps(func)
    async def _async_wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            return await func(*args, **kwargs)
        finally:
            logger.info(f"[timing] {func.__name__}: {time.perf_counter() - start:.2f}s")

    @functools.wraps(func)
    def _sync_wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            return func(*args, **kwargs)
        finally:
            logger.info(f"[timing] {func.__name__}: {time.perf_counter() - start:.2f}s")

    return _async_wrapper if asyncio.iscoroutinefunction(func) else _sync_wrapper

```

### 5.3 C：RAG 核心完整文件

#### code/rag/init.py

修改内容：新增文件：建立 RAG 包。

```python
"""RAG 模块：Retriever 抽象 + provider（教学版内存 provider，生产 ES/RAGFlow）。"""
from .retriever import Chunk, Document, Resource, Retriever

__all__ = ["Chunk", "Document", "Resource", "Retriever"]

```

#### code/rag/retriever.py

修改内容：新增文件：定义 Resource、Document、Chunk 与 Retriever 契约；前端分值字段由这里产生。

```python
"""RAG Retriever 抽象 + 数据模型。

简化自 deepResearch src/rag/retriever.py。
Retriever 是 RAG provider 的抽象（开闭原则：新 provider 只需实现 list_resources + query_relevant_documents）。
教学版 Retriever 用纯 ABC（不继承 BaseModel，方便子类持有状态如内存 dict）。
"""
import abc

from pydantic import BaseModel, Field


class Chunk:
    """检索片段：内容 + 相似度。"""

    def __init__(self, content: str, similarity: float = 1.0):
        self.content = content
        self.similarity = similarity


class Document:
    """检索文档：id + 标题 + chunks。"""

    def __init__(
        self,
        id: str,
        title: str = "",
        url: str | None = None,
        chunks: list[Chunk] | None = None,
        resource_title: str = "",
        rag_platform_id: str = "",
        authorization: str | None = None,
    ):
        self.id = id
        self.title = title
        self.url = url

        self.chunks = chunks or [ ]

        self.resource_title = resource_title
        self.rag_platform_id = rag_platform_id
        self.authorization = authorization

    def to_dict(self) -> dict:
        # 契约对齐原项目 reference-source/deer-flow-aw/src/rag/retriever.py:54-64：
        # 前端 research-activities-block.tsx 的 RetrieverToolCall 组件消费这些字段：
        #   - resource_title：显示"来源：XXX"
        #   - chunks（含 similarity）：ContentDialog 里逐 chunk 展示 + 相似度分
        #   - rag_platform_id：前端多 provider 场景下的归属标记
        # 缺任一都会让检索结果卡片信息不全。
        d = {
            "id": self.id,
            "title": self.title,
            "content": "\n\n".join(c.content for c in self.chunks),
            "resource_title": self.resource_title,
            "rag_platform_id": self.rag_platform_id,
            "chunks": [
                {"content": chunk.content, "similarity": chunk.similarity}
                for chunk in self.chunks
            ],
        }
        if self.url:
            d["url"] = self.url
        if self.authorization:
            d["authorization"] = self.authorization
        return d


class Resource(BaseModel):
    """知识库资源（用户选择/检索的 KB 条目）。"""

    uri: str = Field(..., description="资源 URI（rag:// 协议）")
    title: str = Field(..., description="资源标题")
    rag_platform_id: str = Field(default="", description="RAG 平台 ID")
    description: str = Field(default="", description="资源描述")
    tag: str = Field(default="", description="资源标签")


class Retriever(abc.ABC):
    """RAG provider 抽象：list_resources + query_relevant_documents。

    实现这两个方法即为一个 provider（ES/RAGFlow/内存/…），开闭原则。
    """

    rag_platform_id: str = ""

    @abc.abstractmethod
    def list_resources(self, query: str | None = None) -> list[Resource]:
        """列出知识库资源。"""

    @abc.abstractmethod
    def query_relevant_documents(
        self, query: str, resources: list[Resource] | None = None
    ) -> list[Document]:
        """检索相关文档。"""

```

#### code/rag/memory.py

修改内容：新增文件：零依赖教学 provider。

```python
"""内存 mock provider：演示 Retriever 抽象（避免 ES/RAGFlow 外部依赖）。

生产用 ES / RAGFlow provider（实现 Retriever 接口即可，开闭原则）。
本 provider 用关键词匹配（演示检索流程；生产用向量/混合检索 + 重排）。
"""
from rag.retriever import Chunk, Document, Resource, Retriever


class MemoryRetriever(Retriever):
    """内存知识库 provider。

    knowledge_base 格式：{uri: {"title": str, "desc": str, "chunks": [str]}}
    """

    def __init__(self, knowledge_base: dict | None = None):
        self.rag_platform_id = "memory"
        self._kb = knowledge_base or {}

    def list_resources(self, query: str | None = None) -> list[Resource]:
        return [
            Resource(
                uri=uri,
                title=kb.get("title", uri),
                rag_platform_id="memory",
                description=kb.get("desc", ""),
                tag="",
            )
            for uri, kb in self._kb.items()
        ]

    def query_relevant_documents(
        self, query: str, resources: list[Resource] | None = None
    ) -> list[Document]:
        """关键词匹配（query 命中 chunk 内容即返回）。"""
        q = (query or "").lower().strip()
        if not q:

            return [ ]


        docs = [ ]

        # 若指定 resources，只搜这些 uri；否则搜全部

        target_uris = {r.uri for r in (resources or [])} or set(self._kb.keys())

        for uri in target_uris:
            kb = self._kb.get(uri)
            if not kb:
                continue
            matched = [
                Chunk(content=c, similarity=1.0)

                for c in kb.get("chunks", [])

                if q in c.lower()
            ]
            if matched:
                docs.append(
                    Document(
                        id=uri,
                        title=kb.get("title", uri),
                        chunks=matched,
                        resource_title=kb.get("title", uri),
                        rag_platform_id="memory",
                    )
                )
        return docs

```

#### code/rag/builder.py

修改内容：新增文件：构建全部启用 provider，始终返回 list\[Retriever\]。

```python
"""Retriever 工厂：按配置构建 provider。

教学版支持 memory provider（从 list[dict] 构建）。
生产扩展：根据配置 platform 字段选择 ES/RAGFlow/AIHub/… provider（开闭原则）。
"""
from rag.retriever import Retriever


def build_retriever_by_configs(
    resources: list[dict] | None = None,
    enabled_configs: list[dict] | None = None,
    similarity: float = 0.4,
    retriever_keyword: str = "",
    override_similarity: bool = False,
) -> list[Retriever]:
    """从资源列表或平台配置构建 Retriever。

    Args:
        resources: [{"uri":..., "title":..., "desc":..., "chunks":[str]}]（内存格式，教学主线）
        enabled_configs: [{"platform":..., "rag_platform_id":..., "api_url":...,
                           "retrieval_size":..., "ext_config": {...}}]（平台配置，如 aihub）
        similarity: 检索相似度阈值（平台配置生效）
        retriever_keyword: 检索关键词（预留字段，当前未 per-config 持久化——
                         RagConfig 表/前端 UI 均无此键，走函数默认 ""；
                         similarity 已 per-config 生效）
    Returns:

        Retriever 列表；空则 []。与原项目 build_retriever_by_configs 一致，

        所有启用配置都会参与检索。

    优先使用 enabled_configs（平台配置），为空时回退到 resources（内存格式）。
    """
    # ── 平台配置分支（aihub 等） ──
    if enabled_configs:

        retrievers: list[Retriever] = [ ]

        for config in enabled_configs:
            platform = config.get("platform", "")
            if platform == "aihub":
                from rag.aihub import AIHubProvider

                username = config.get("ext_config", {}).get("username")
                password = config.get("ext_config", {}).get("password")
                retrievers.append(AIHubProvider(
                    rag_platform_id=config.get("rag_platform_id", ""),
                    api_url=config.get("api_url", ""),
                    username=username or "",
                    password=password or "",
                    retrieval_size=config.get("retrieval_size", 10),
                    similarity=(
                        similarity
                        if override_similarity
                        else config.get("similarity", similarity)
                    ),
                    retriever_keyword=config.get("retriever_keyword", retriever_keyword),
                ))
        return retrievers

    # ── 内存格式分支（教学主线） ──
    if not resources:

        return [ ]

    from rag.memory import MemoryRetriever

    kb = {}
    for r in resources:
        uri = r.get("uri") or r.get("title") or ""
        if not uri:
            continue
        kb[uri] = {
            "title": r.get("title", uri),
            "desc": r.get("desc", ""),

            "chunks": r.get("chunks", []) or [],

        }

    return [MemoryRetriever(kb)] if kb else [ ]


```

#### code/tools/retriever.py

修改内容：新增文件：多 provider 合并，keywords 入参，结构化 list\[dict\] 返回。

```python
"""RetrieverTool：local_search_tool（BaseTool，从私有知识库检索）。

参考 deepResearch tools/retriever.py。
researcher 用它检索私有知识库（vs web_search 联网）。
RAG-web 协同：本地无结果时 researcher 自主转 web（prompt 引导 + 工具描述提示）。

契约对齐原项目 reference-source/deer-flow-aw/src/tools/retriever.py：
- 参数名用 `keywords`（前端 KeywordsList 组件读的就是 toolCall.args.keywords）
- 返回 list[dict]（前端 RetrieverToolCall 用 parseJSON 消费），不返回 markdown
- description 保持原项目原文，鼓励 LLM 优先调用本地检索
"""
from typing import Any

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from rag.retriever import Document, Resource, Retriever


class _LocalSearchInput(BaseModel):
    keywords: str = Field(..., description="search keywords to look up")


class RetrieverTool(BaseTool):
    """local_search_tool：检索私有知识库。"""

    name: str = "local_search_tool"
    description: str = (
        "Useful for retrieving information from the file with `rag://` uri prefix, "
        "it should be higher priority than the web search or writing code. "
        "Input should be a search keywords."
    )
    args_schema: type = _LocalSearchInput
    retrievers: list[Any] = Field(default_factory=list)  # 对齐原项目：合并多 provider
    resources: list = Field(default_factory=list)

    def _run(self, keywords: str, **kwargs) -> list[dict]:
        if not self.retrievers:
            # 空 list：前端 RetrieverToolCall 会显示"当前没有检索到相关知识库来源"
            # LLM 看到空列表也会自主转向 web_search

            return [ ]


        docs = [ ]

        for retriever in self.retrievers:
            docs.extend(retriever.query_relevant_documents(keywords, self.resources))
        if not docs:

            return [ ]

        # 返回 list[dict]（不是 markdown 字符串）—— 前端 parseJSON 需要 JSON 数组。
        # Document.to_dict() 已包含 {id, title, content, url?, authorization?} 字段。
        return [d.to_dict() for d in docs]

    async def _arun(self, keywords: str, **kwargs) -> list[dict]:
        return self._run(keywords, **kwargs)


def make_local_search_tool(retrievers: list[Retriever], resources: list[Resource] | None = None) -> RetrieverTool:
    """工厂：创建 local_search_tool（传入多个 Retriever + 用户选择的 resources）。"""

    return RetrieverTool(retrievers=retrievers, resources=resources or [])


```

#### code/rag/rerank.py

修改内容：新增文件：AIHub 检索后的重排适配。

```python
"""知识库检索后的 Rerank 操作，调用外部 rerank 接口，对检索到的文档进行排序。

移植自 deepResearch src/rag/rerank.py。
三处适配：
1. 模块路径：from src.rag.retriever → from rag.retriever；配置读取改用本地 _load_yaml_config（与 llm.py 同模式）
2. 懒加载：模块级单例 dmx_reranker 改为 get_reranker() 函数，避免 import 时触发初始化（空配置会抛 ValueError）
3. type 配置兼容 dmx|emb：支持 DMX 原格式（model/api_key/Authorization）和 emb 格式（/api/emb/rerank + contents/top_k），
   通过 RERANK_MODEL.type 配置项切换，默认 dmx。偏离主项目单 DMX 格式，但支持更多 rerank 服务。
"""

import json
from pathlib import Path

import requests
from pydantic import Field

from rag.retriever import Chunk, Document

# 配置文件路径：code/ 目录下的 conf.yaml（与 llm.py 同模式）
_CONF_PATH = Path(__file__).resolve().parent.parent / "conf.yaml"


def _load_yaml_config() -> dict:
    """读取 conf.yaml。"""
    import yaml

    if not _CONF_PATH.exists():
        return {}
    with open(_CONF_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def get_rerank_config() -> dict:
    config = _load_yaml_config()
    return config.get("RERANK_MODEL", {})


class DMXReranker:
    """Reranker uses AIHub rerank model to rerank documents."""

    name: str = "dmx_reranker"
    base_url: str = Field(..., description="The base URL of the rerank model API")
    model: str = Field(..., description="The name of the rerank model")
    api_key: str = Field(
        ..., description="The API key for authenticating with the rerank model"
    )
    top_n: int = Field(
        default=6, description="The number of top documents to return after reranking"
    )

    _instance = None

    def __init__(self):
        rerank_config = self.get_rerank_config()
        self.rerank_type = rerank_config.get("type", "dmx")
        self.base_url = rerank_config.get("base_url", "")
        self.model = rerank_config.get("model", "")
        self.api_key = rerank_config.get("api_key", "")
        self.top_n = rerank_config.get("top_n", 6)
        if self.rerank_type == "dmx":
            if not self.base_url or not self.model or not self.api_key:
                raise ValueError(
                    "dmx rerank: base_url, model, and api_key must be provided in the configuration"
                )
        elif self.rerank_type == "emb":
            if not self.base_url:
                raise ValueError(
                    "emb rerank: base_url must be provided in the configuration"
                )
        else:
            raise ValueError(
                f"Unsupported rerank type: {self.rerank_type!r}, expected 'dmx' or 'emb'"
            )

    def __new__(cls) -> "DMXReranker":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def get_rerank_config(self):
        config = _load_yaml_config()
        rerank_config = config.get("RERANK_MODEL", {})
        return rerank_config

    def rerank(self, query: str, records: list) -> list:
        """Rerank the documents based on the query.

        Args:
            query (str): The query text.
            records (list[dict]): The list of documents to rerank.

        Returns:
            list[dict]: The reranked list of documents.
        """
        if not records:

            return [ ]


        records_map = {idx: record for idx, record in enumerate(records)}

        if self.rerank_type == "emb":
            # emb 格式：POST {base_url}/rerank + {query, contents, top_k}
            payload = {
                "query": query,
                "contents": [r["content"] for r in records],
                "top_k": self.top_n,
            }
            response = requests.post(
                f"{self.base_url}/rerank", json=payload, timeout=30
            )
            response.raise_for_status()
            indices = [item["index"] for item in response.json()["data"]]
        else:
            # dmx 格式（原逻辑）：POST {base_url}/rerank + Authorization
            payload = {
                "model": self.model,
                "query": query,
                "top_n": self.top_n,
                "documents": [record["content"] for record in records],
            }
            headers = {
                "Authorization": f"{self.api_key}",
                "Content-Type": "application/json",
            }
            response = requests.post(
                f"{self.base_url}/rerank", headers=headers, data=json.dumps(payload)
            )
            response.raise_for_status()
            indices = [result["index"] for result in response.json()["results"]]

        return [records_map[idx] for idx in indices]


# 懒加载单例：首次调用时才初始化（读 conf.yaml），
# 避免 import 时因空 RERANK_MODEL 配置抛出 ValueError。
_reranker_instance: DMXReranker | None = None


def get_reranker() -> DMXReranker:
    """获取 DMXReranker 单例（懒加载）。

    首次调用时读取 conf.yaml 的 RERANK_MODEL 配置并初始化。
    Task 3 的 aihub.py 通过 get_reranker().rerank(query, records) 调用。
    """
    global _reranker_instance
    if _reranker_instance is None:
        _reranker_instance = DMXReranker()
    return _reranker_instance

```

#### code/rag/aihub.py

修改内容：新增文件：真实 AIHub 登录、缓存、检索、重排与连接检查。

```python
"""AIHub 知识库 provider：连接 AIHub 平台进行知识库检索。

移植自 deepResearch src/rag/aihub.py。
5 处适配：
1. rerank: from rag.rerank import get_reranker（懒加载），调用 get_reranker().rerank(query, records)
2. retriever import: from rag.retriever import ...（去 src. 前缀）
3. list API 读 env: DATASET_API_PATH = os.getenv("AIHUB_LIST_RESOURCES_API", "/api/dataset")
4. ddddocr 懒加载：不在顶层 import ddddocr，首次 _parse_captcha 时初始化（ch10 默认未装 ddddocr）
5. AIHubProvider 构造：ch10 Retriever 是纯 ABC（非 BaseModel），字段用 __init__ 参数赋值（参照 MemoryRetriever）
"""
import hashlib
import logging
import os
import threading
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, TypeVar
from urllib.parse import urlparse

import requests

from rag.rerank import get_reranker
from rag.retriever import Chunk, Document, Resource, Retriever

logger = logging.getLogger(__name__)

T = TypeVar("T")


class TokenExpiredError(Exception):
    """Exception raised when the token has expired."""

    pass


# ── 全局缓存变量 ──────────────────────────────────────────────
_global_resources_cache_map: dict[str, list[dict]] = {}
_global_cache_timestamp_map: dict[str, float] = {}
_global_cache_lock = threading.Lock()

_global_api_token = None
_global_token_expires_at = None

RESOURCE_CACHE_DUTATION = 10  # resources 资源列表缓存超时时间，默认缓存 10 秒
TOKEN_DURATION = int(os.getenv("AIHUB_TOKEN_DURATION", 60 * 60))
# 知识库 UI 路径
DATASET_UI_PATH = "/ui/dataset"
# 知识库 API 路径（适配点 3：从环境变量读取）
DATASET_API_PATH = os.getenv("AIHUB_LIST_RESOURCES_API", "/api/dataset")

# 适配点 4：ddddocr 懒加载（不在顶层 import）
_ocr_instance = None


def _get_ocr():
    """获取 ddddocr 实例（懒加载，首次调用时才 import 并初始化）。

    ch10 默认环境未装 ddddocr（optional extras），
    只有真正需要验证码识别时（uv run --extra aihub）才触发此 import。
    """
    global _ocr_instance
    if _ocr_instance is None:
        import ddddocr

        _ocr_instance = ddddocr.DdddOcr()
    return _ocr_instance


# 使用 RLock 替代 Lock 以支持重入
_token_lock = threading.RLock()


class AIHubProvider(Retriever):
    """AIHub 知识库 provider：连接 AIHub 平台进行检索。"""

    # 适配点 5：ch10 Retriever 是纯 ABC（非 BaseModel），
    # 字段用 __init__ 参数赋值（参照 MemoryRetriever 的写法）。

    def __init__(
        self,
        rag_platform_id: str = "",
        api_url: str = "",
        username: str = "",
        password: str = "",
        retrieval_size: int = 10,
        similarity: float = 0.4,
        retriever_keyword: str = "",
    ):
        self.rag_platform_id = rag_platform_id
        self.api_url = api_url
        self.username = username
        self.password = password
        self.retrieval_size = retrieval_size
        self.similarity = similarity
        self.retriever_keyword = retriever_keyword

        logger.info(
            f"AIHubProvider initialized - Username: {username}, Password source: {'env' if password else 'default'}"
        )

    def _parse_captcha(self, captcha_image_url: str) -> str:
        """Parse the captcha image and return the response string.

        This method downloads the captcha image and uses OCR to extract the text.
        Falls back to pattern matching and default values if OCR fails.

        Args:
            captcha_image_url: URL of the captcha image.

        Returns:
            str: Response string.
        """
        try:
            # 下载验证码图片
            response = requests.get(captcha_image_url, timeout=10)
            response.raise_for_status()

            # 首次调用时懒加载 ddddocr
            ocr = _get_ocr()

            # 首先尝试使用 OCR 识别验证码图片
            captcha_text = ocr.classification(response.content)

            if captcha_text:
                return str(captcha_text)

            # 如果以上方法都失败，返回默认值
            logger.warning("无法自动识别验证码，使用默认值")
            return "8888"  # 默认值，某些测试环境可能接受

        except Exception as e:
            logger.error(f"验证码识别失败: {str(e)}")
            # 返回默认值作为后备方案
            return "8888"

    def _log_in(self) -> None:
        """Log in and update the token with expiration time."""
        # 先请求验证码
        response = requests.request(
            method="get",
            url=f"{self.api_url}/api/user/captcha/refresh",
            headers={"Content-Type": "application/json"},
            json={"username": self.username, "password": self.password},
        )
        result = response.json()
        captcha_hashkey = (result.get("data") or {}).get("captcha_hashkey")
        captcha_image_url = (result.get("data") or {}).get("captcha_image")
        # 解析验证码
        captcha_response = self._parse_captcha(captcha_image_url)

        result = self._make_request(
            method="post",
            endpoint="/api/user/login",
            json={
                "username": self.username,
                "password": self.password,
                "captcha_hashkey": captcha_hashkey,
                "captcha_response": captcha_response,
            },
        )
        logger.info(f"登录结果: {result}")
        logger.info(
            f"captcha_image_url: {captcha_image_url}, captcha_response: {captcha_response}"
        )
        global _global_api_token, _global_token_expires_at
        with _token_lock:
            _global_api_token = (result.get("data") or {}).get("token")
            # 假设 token 默认 1 小时过期，实际应该从响应中获取
            _global_token_expires_at = datetime.now() + timedelta(
                seconds=TOKEN_DURATION
            )

    def refresh_token(self) -> None:
        """Refresh the authentication token."""
        # 更新 token
        self._log_in()

    def query_relevant_documents(
        self, query: str, resources: list[Resource] | None = None
    ) -> list[Document]:
        query_text = self.retriever_keyword if self.retriever_keyword else query
        logger.info(f"-----------------similarity:{self.similarity}")
        logger.info(f"-----------------query_text:{query_text}")
        resources_url = self.api_url.strip("/") + DATASET_UI_PATH
        all_documents: dict[str, Document] = {}

        for resource in (resources or []):

            if resource.rag_platform_id != self.rag_platform_id:
                logger.debug(f"Resource {resource.uri} is not from AIHub, skip it.")
                continue
            dataset_id, _ = parse_uri(resource.uri)
            result = self._make_request(
                method="get",
                endpoint=(
                    f"/api/dataset/{dataset_id}/hit_test?"
                    f"query_text={query_text}&"
                    f"similarity={str(self.similarity)}&"
                    f"top_number={self.retrieval_size}&"
                    f"search_mode=embedding"
                ),
                params={},
            )
            records = result.get("data") or {}

            if not isinstance(records, list):
                logger.warning(f"API返回的data不是列表，跳过处理: {records}")
                continue

            # 适配点 1：get_reranker().rerank(query, records)
            records = get_reranker().rerank(query_text, records)

            for record in records:
                doc_id = record.get("document_id", "")
                if doc_id not in all_documents:
                    all_documents[doc_id] = Document(
                        id=doc_id,
                        title=record.get("document_name"),
                        rag_platform_id=self.rag_platform_id,

                        chunks=[],

                        resource_title=resource.title,
                        url=f"{resources_url}/{dataset_id}/{doc_id}?name={resource.title}&readonly=true",
                        authorization=_global_api_token,
                    )

                chunk = Chunk(
                    content=record.get("content", ""),
                    similarity=record.get("similarity", 0.0),
                )
                all_documents[doc_id].chunks.append(chunk)
        return list[Document](all_documents.values())

    def _cache_key(self, query: str | None) -> str:
        ident = getattr(self, "username", None) or getattr(self, "api_key", None) or ""
        raw = f"{self.api_url}|{ident}|{query or ''}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def list_resources(
        self, query: str | None = None, use_cache: bool = True
    ) -> list[Resource]:
        global _global_resources_cache_map, _global_cache_timestamp_map, _global_cache_lock

        current_time = time.time()
        cache_key = self._cache_key(query)
        with _global_cache_lock:
            cached_resources = None

            if use_cache:
                ts = _global_cache_timestamp_map.get(cache_key)
                cache = _global_resources_cache_map.get(cache_key)

                if ts is not None and cache is not None and (current_time - ts <= RESOURCE_CACHE_DUTATION):
                    cached_resources = cache
                    logger.info(f"使用缓存数据: {len(cached_resources)} 条记录")

            if cached_resources is None:
                params = {"name": query} if query else {}
                logger.info(f"获取知识库数据: {params}, 缓存过期或不存在")
                logger.info(f"-----------------list_resources_api:{DATASET_API_PATH}")
                try:
                    result = self._make_request(method="get", endpoint=DATASET_API_PATH, params=params)
                except Exception as e:
                    logger.exception("获取知识库列表失败")
                    raise


                cached_resources = result.get("data") or [ ]

                _global_resources_cache_map[cache_key] = cached_resources
                _global_cache_timestamp_map[cache_key] = current_time
                logger.info(f"更新全局缓存: {len(cached_resources)} 条记录")

        # 构建 Resource 对象列表

        resources = [ ]

        for item in cached_resources:
            resource = Resource(
                rag_platform_id=self.rag_platform_id,
                uri=f"rag://dataset/{item.get('id')}",
                title=item.get("name", ""),
                description=item.get("desc", ""),
                tag=item.get("tag_name", ""),
            )
            # 如果有查询条件，进行过滤
            if not query or query in item.get("name", ""):
                resources.append(resource)

        return resources

    def test_connection(self) -> dict:
        global _global_api_token, _global_token_expires_at

        try:
            logger.info(f"[test_connection] api_url={self.api_url}, username={self.username}")
            with _token_lock:
                _global_api_token = None
                _global_token_expires_at = None

            self._log_in()
            resources = self.list_resources(use_cache=False)

            return {
                "success": True,
                "resource_count": len(resources),
                "message": "AIHub knowledge base connected successfully",
            }

        except Exception as e:
            return {
                "success": False,
                "resource_count": 0,
                "message": f"{type(e).__name__}: {e}",
            }

    def _get_valid_token(self) -> str:
        """获取有效的 token，如果过期则刷新"""
        global _global_api_token, _global_token_expires_at
        with _token_lock:
            now = datetime.now()
            # 双重检查模式，避免在锁内执行耗时操作
            if (
                not _global_api_token
                or not _global_token_expires_at
                or _global_token_expires_at - now >= timedelta(seconds=TOKEN_DURATION)
            ):
                if (not _global_api_token) or (not _global_token_expires_at) or (now >= _global_token_expires_at):
                    self._log_in()
            return _global_api_token

    def _make_request(
        self, method: str, endpoint: str, max_retries: int = 5, **kwargs
    ) -> Dict[str, Any]:
        """Make an HTTP request with token refresh and retry logic.

        Args:
            method: HTTP method (get, post, etc.)
            endpoint: API endpoint to call
            max_retries: Maximum number of retries on token expiration
            **kwargs: Additional arguments to pass to requests.request

        Returns:
            The JSON response as a dictionary

        Raises:
            Exception: If the request fails after all retries
        """
        global _global_api_token, _global_token_expires_at
        headers = kwargs.pop("headers", {})

        for attempt in range(max_retries + 1):
            try:
                # 对于登录接口，不需要添加 Authorization 头
                if endpoint != "/api/user/login":
                    token = self._get_valid_token()
                    headers["Authorization"] = f"{token}"
                headers.setdefault("Content-Type", "application/json")

                response = requests.request(
                    method=method,
                    url=f"{self.api_url}{endpoint}",
                    headers=headers,
                    **kwargs,
                )

                # 修改 _make_request 方法中的检查逻辑
                if response.status_code == 200:
                    return response.json()
                elif response.status_code == 401:
                    response_data = response.json()
                    # 检查返回的 JSON 中是否包含错误码
                    if (
                        isinstance(response_data, dict)
                        and response_data.get("code") == 1002
                        and attempt < max_retries
                    ):
                        with _token_lock:
                            _global_api_token = None
                            _global_token_expires_at = None
                        continue
                    else:
                        return response_data
                else:
                    response.raise_for_status()

            except Exception as e:
                if attempt == max_retries:
                    raise Exception(
                        f"API request failed after {max_retries} retries: {str(e)}"
                    )
                # 请求异常时，更新 token
                self.refresh_token()
                time.sleep(1)  # Simple backoff

        # 如果所有重试都失败，返回空的字典
        return {}


def parse_uri(uri: str) -> tuple[str, str]:
    parsed = urlparse(uri)
    if parsed.scheme != "rag":
        raise ValueError(f"Invalid URI: {uri}")
    return parsed.path.split("/")[1], parsed.fragment

```

### 5.4 D+E：PG 配置、数据库稳定性与 MCP

#### code/server/rag\_request.py

修改内容：新增文件：RAG 配置和连接测试输入模型。

```python
from typing import Any

from pydantic import BaseModel, Field


class RAGConfigPayload(BaseModel):
    """知识库配置的可验证输入。"""

    name: str = Field(min_length=1)
    platform: str = Field(min_length=1)
    api_url: str = ""
    ext_config: dict[str, Any] = Field(default_factory=dict)
    retrieval_size: int = Field(default=5, ge=1, le=100)
    similarity: float = Field(default=0.5, ge=0.0, le=1.0)
    is_enabled: bool = True


class RAGConnectionPayload(BaseModel):
    platform: str = Field(min_length=1)
    api_url: str = ""
    ext_config: dict[str, Any] = Field(default_factory=dict)

```

#### code/server/rag\_config\_service.py

修改内容：新增文件：PG 完成态 service；不要再复制前文内存中间版。

```python
"""RAG 配置服务：PG 持久化后端。

接口签名与原内存版保持一致（list_configs / create / update / delete / query_resources / clear），
仅存储后端从内存 dict → PG repository。
"""
from uuid import uuid4

from sqlalchemy.orm import Session

from database import repository
from server.rag_request import RAGConfigPayload


class RAGConfigService:
    """RAG 配置仓库：PG 持久化（接口不变，对齐前端 API 契约）。"""

    def list_configs(self, db: Session) -> list[dict]:
        return repository.list_rag_configs(db)

    def create(self, db: Session, payload: RAGConfigPayload) -> dict:
        config_id = uuid4().hex
        return repository.create_rag_config(db, config_id, payload.model_dump())

    def update(self, db: Session, config_id: str, changes: dict) -> dict | None:
        return repository.update_rag_config(db, config_id, changes)

    def delete(self, db: Session, config_id: str) -> bool:
        return repository.delete_rag_config(db, config_id)

    def query_resources(self, db: Session, query: str = "") -> list[dict]:
        return repository.query_rag_resources(db, query)

    def clear(self, db: Session) -> None:
        """清空全部配置（测试用）。"""
        from database.models import RagConfig

        db.query(RagConfig).delete()
        db.commit()


rag_config_service = RAGConfigService()

```

#### code/database/models.py

修改内容：完整覆盖：保留聊天与图事件表，并增加 RagConfig。

```python
"""业务表：会话生命周期。

简化自 deepResearch 的 4 表（chat_streams / custom_templates / langgraph_events / research_replays）。
教学版第8章做核心 2 表（业务侧持久化的基石）：
  - ChatStream：对话全文分片（每个 SSE 帧存一行，支持刷新页面看历史 + 重启恢复）
  - LanggraphEvent：节点事件流水（业务可观测，第9/10章细化）
custom_templates（新 ch11「研究产出加工」报告模板）/ research_replays（第9章回放索引）后续章节加。

vs checkpointer：checkpointer 存的是 langgraph 内部状态（resume 用），偏开发态；
业务表存的是"给用户/产品看的"结构化数据（对话全文、事件、回放），偏产品态。
"""
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text

from database.base import Base


class ChatStream(Base):
    """对话流水分片表：每个 SSE 帧存一行。"""

    __tablename__ = "chat_streams"

    id = Column(Integer, primary_key=True, autoincrement=True)
    thread_id = Column(String, nullable=False, index=True, comment="会话ID")
    event_type = Column(String, nullable=False, comment="事件类型 message_chunk/tool_calls/...")
    content = Column(Text, comment="事件数据（SSE 帧 JSON）")
    finish_reason = Column(String, default="none", comment="结束原因 none/stop")
    created_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), comment="创建时间"
    )


class LanggraphEvent(Base):
    """节点事件流水：业务可观测（无 LangSmith 也能复盘，合规行业必备）。"""

    __tablename__ = "langgraph_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    thread_id = Column(String, nullable=False, index=True, comment="会话ID")
    node = Column(String, nullable=False, comment="节点名 researcher/reporter/...")
    event_level = Column(String, default="info", comment="日志级别 info/warning/error")
    payload = Column(Text, comment="JSON 序列化的事件数据")
    created_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), comment="创建时间"
    )


class RagConfig(Base):
    """RAG 知识库配置（多 platform：memory/aihub/...）。PG 持久化。"""

    __tablename__ = "rag_configs"

    id = Column(String, primary_key=True, comment="uuid4 hex")
    name = Column(String, nullable=False)
    platform = Column(String, nullable=False, comment="memory|aihub|...")
    api_url = Column(String, default="")
    ext_config = Column(Text, default="{}", comment="JSON: username/password/resources/...")
    retrieval_size = Column(Integer, default=5)
    similarity = Column(Float, default=0.5)
    is_enabled = Column(Boolean, default=True)
    created_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), comment="创建时间"
    )

```

#### code/database/repository.py

修改内容：完整覆盖：增加 RAG 配置 PG CRUD 与序列化。

```python
"""会话 CRUD：对话落库 + list/get/delete + 节点事件记录。

业务侧持久化（vs checkpointer）：这里存的是产品可见的结构化数据。
"""
import json
import logging

from sqlalchemy import func
from sqlalchemy.orm import Session

from database.models import ChatStream, LanggraphEvent, RagConfig

logger = logging.getLogger(__name__)


# ---------- 对话流水 ----------

def append_chat_stream(
    db: Session, thread_id: str, event_type: str, content: str, finish_reason: str = "none"
) -> ChatStream:
    """追加一条对话事件（SSE 帧落库，支持刷新/重启后回看）。"""
    row = ChatStream(
        thread_id=thread_id,
        event_type=event_type,
        content=content,
        finish_reason=finish_reason,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_conversations(db: Session) -> list[dict]:
    """列出所有会话（thread_id 去重 + 最后更新时间 + 帧数统计）。

    沿用第8章同表结构下已验证的 Conversation 契约实现：
    - id / title / date / category / count / data_type

    本章与 ch08 共用逐帧 ChatStream 模型，不照搬主项目 research_replays 独立表；
    但返回字段严格对齐主项目前端 ConversationsDialog。
    """
    # 每个 thread_id 的最新时间 + 帧数
    stats = (
        db.query(
            ChatStream.thread_id,
            func.max(ChatStream.created_at).label("last_ts"),
            func.count(ChatStream.id).label("cnt"),
        )
        .group_by(ChatStream.thread_id)
        .order_by(func.max(ChatStream.created_at).desc())
        .all()
    )


    result = [ ]

    for tid, last_ts, cnt in stats:
        # 找该 thread 的首帧 content 作 title 摘要（截 30 字）
        first_row = (
            db.query(ChatStream.content)
            .filter(ChatStream.thread_id == tid, ChatStream.event_type == "message_chunk")
            .order_by(ChatStream.id)
            .first()
        )
        title = tid
        if first_row and first_row[0]:
            try:
                data = json.loads(first_row[0])
                if isinstance(data, dict):
                    content = (data.get("content") or "").strip()
                    if content:
                        title = content[:30] + ("…" if len(content) > 30 else "")
            except (ValueError, TypeError):
                pass

        result.append(
            {
                "id": tid,
                "title": title,
                "date": last_ts.isoformat() if last_ts else None,
                "category": "research",
                "count": cnt,
                "data_type": "chat",
                "thread_id": tid,
                "updated_at": last_ts.isoformat() if last_ts else None,
            }
        )
    return result


def get_conversation(db: Session, thread_id: str) -> list[dict]:
    """获取某会话的全部事件（按时间顺序，前端回放用）。"""
    rows = (
        db.query(ChatStream)
        .filter(ChatStream.thread_id == thread_id)
        .order_by(ChatStream.id)
        .all()
    )
    return [
        {
            "event_type": r.event_type,
            "content": r.content,
            "finish_reason": r.finish_reason,
        }
        for r in rows
    ]


def delete_conversation(db: Session, thread_id: str) -> int:
    """删除某会话的全部事件。返回删除条数。"""
    n = db.query(ChatStream).filter(ChatStream.thread_id == thread_id).delete()
    db.commit()
    return n


# ---------- 节点事件（业务可观测）----------

def log_graph_event(
    db: Session, thread_id: str, node: str, payload: dict, event_level: str = "info"
) -> LanggraphEvent:
    """记录节点事件（业务侧可观测，第9/10章细化）。"""
    row = LanggraphEvent(
        thread_id=thread_id,
        node=node,
        event_level=event_level,
        payload=json.dumps(payload, ensure_ascii=False),
    )
    db.add(row)
    db.commit()
    return row


def get_graph_events(db: Session, thread_id: str) -> list[dict]:
    """获取某会话的节点事件流水（业务可观测：无 LangSmith 也能复盘节点轨迹）。"""
    rows = (
        db.query(LanggraphEvent)
        .filter(LanggraphEvent.thread_id == thread_id)
        .order_by(LanggraphEvent.id)
        .all()
    )
    return [
        {
            "node": r.node,
            "level": r.event_level,
            "payload": r.payload,
            "time": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


# ---------- RAG 配置持久化 ----------

def list_rag_configs(db: Session) -> list[dict]:
    """列出所有 RAG 配置。"""
    rows = db.query(RagConfig).order_by(RagConfig.created_at.desc()).all()
    return [_rag_config_to_dict(r) for r in rows]


def create_rag_config(db: Session, config_id: str, data: dict) -> dict:
    """创建一条 RAG 配置。"""
    row = RagConfig(
        id=config_id,
        name=data["name"],
        platform=data["platform"],
        api_url=data.get("api_url", ""),
        ext_config=json.dumps(data.get("ext_config", {}), ensure_ascii=False),
        retrieval_size=data.get("retrieval_size", 5),
        similarity=data.get("similarity", 0.5),
        is_enabled=data.get("is_enabled", True),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _rag_config_to_dict(row)


def update_rag_config(db: Session, config_id: str, changes: dict) -> dict | None:
    """更新一条 RAG 配置，不存在返回 None。"""
    row = db.query(RagConfig).filter(RagConfig.id == config_id).first()
    if row is None:
        return None
    for key, value in changes.items():
        if key == "ext_config":
            row.ext_config = json.dumps(value, ensure_ascii=False)
        elif hasattr(row, key):
            setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return _rag_config_to_dict(row)


def delete_rag_config(db: Session, config_id: str) -> bool:
    """删除一条 RAG 配置，返回是否成功。"""
    n = db.query(RagConfig).filter(RagConfig.id == config_id).delete()
    db.commit()
    return n > 0


def query_rag_resources(db: Session, query: str = "") -> list[dict]:
    """从已启用的 RAG 配置中检索匹配的资源。"""
    rows = db.query(RagConfig).filter(RagConfig.is_enabled == True).all()  # noqa: E712
    needle = query.casefold().strip()

    resources = [ ]

    for row in rows:
        try:
            ext = json.loads(row.ext_config) if row.ext_config else {}
        except (json.JSONDecodeError, TypeError):
            ext = {}

        for resource in ext.get("resources", []):

            haystack = " ".join(
                str(resource.get(k, ""))
                for k in ("uri", "title", "description")
            ).casefold()
            if not needle or needle in haystack:
                resources.append(dict(resource))
    return resources


def _rag_config_to_dict(row: RagConfig) -> dict:
    """RagConfig ORM 行 → dict（ext_config 反序列化 JSON）。"""
    try:
        ext = json.loads(row.ext_config) if row.ext_config else {}
    except (json.JSONDecodeError, TypeError):
        ext = {}
    return {
        "id": row.id,
        "name": row.name,
        "platform": row.platform,
        "api_url": row.api_url or "",
        "ext_config": ext,
        "retrieval_size": row.retrieval_size,
        "similarity": row.similarity,
        "is_enabled": row.is_enabled,
        # 契约兼容主项目 rag.py:114/138：前端 knowledge-tab.tsx:165 读 config.is_selected
        # 判断开关初始态。值语义与 is_enabled 相同，两者并存以对齐前端预期。
        "is_selected": row.is_enabled,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }

```

#### code/database/base.py

修改内容：完整覆盖：CB-2 连接池和数据库超时。

```python
"""数据库基类：engine + SessionLocal + Base + init_db（加固版）。

本章可观测增量：在最小配（CB-1）基础上加连接池/statement_timeout/pool_pre_ping，
对齐主项目 deer-flow-aw/src/database/base.py。
"""
import logging
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:5432/postgres")

engine = create_engine(
    DATABASE_URL,
    pool_size=int(os.getenv("DB_POOL_SIZE", "10")),       # 常驻连接数
    max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),  # 突发可溢出
    pool_recycle=int(os.getenv("DB_POOL_RECYCLE", "3600")),  # 连接回收(秒)
    pool_pre_ping=True,                                    # 连接前 ping，防已断连接
    connect_args={
        "connect_timeout": 10,                             # 建连超时(秒)
        "options": "-c statement_timeout=30000",           # SQL 执行超时 30s，慢查询熔断
    },
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def init_db() -> None:
    """建表（首次启动调用）。"""
    from database import models  # noqa: F401

    Base.metadata.create_all(engine)
    logger.info(f"[database] 表已就绪（加固版连接池）：{DATABASE_URL}")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

```

#### code/server/mcp\_utils.py

修改内容：新增文件：MCP 总开关、超时与异常降级。

```python
"""MCP 工具加载：从 MCP server 动态加载工具（stdio / sse / streamable_http 三 transport）。

参考 deepResearch server/mcp_utils.py + graph/nodes.py:_setup_and_execute_agent_step。

用 langchain_mcp_adapters 的 MultiServerMCPClient（直接返回 LangChain Tool，agent 可调用）。
工具来源标注：description 加 `Powered by '<server>'.`，便于审计工具来源。

⚠️ 安全：MCP（尤其 stdio）可执行任意命令，必须 ENABLE_MCP_SERVER_CONFIGURATION=true 才启用。
默认关闭，避免任意命令执行风险。
"""
import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)


async def load_mcp_tools(mcp_servers: dict, timeout_seconds: int = 60) -> list:
    """从多个 MCP server 加载工具，返回 LangChain Tool 列表。

    Args:
        mcp_servers: {server_name: {transport/command/args/url/env/headers}} 格式
        timeout_seconds: 单次加载超时（首次执行较慢，默认 60s）
    Returns:
        LangChain Tool 列表（加载失败返回空列表，不影响主流程）
    """
    if not mcp_servers:

        return [ ]


    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient
    except ImportError:
        logger.warning(
            "[mcp] langchain-mcp-adapters 未安装，跳过 MCP 工具加载"
            "（pip install langchain-mcp-adapters）"
        )

        return [ ]


    try:
        client = MultiServerMCPClient(mcp_servers)
        tools = await asyncio.wait_for(client.get_tools(), timeout=timeout_seconds)
        logger.info(
            f"[mcp] 从 {len(mcp_servers)} 个 MCP server 加载 {len(tools)} 个工具: "
            f"{[t.name for t in tools]}"
        )
        return tools
    except TimeoutError:
        logger.error(f"[mcp] 加载 MCP 工具超时（{timeout_seconds}s）")

        return [ ]

    except Exception as e:
        logger.error(f"[mcp] 加载 MCP 工具失败（不影响主流程）: {e}")

        return [ ]



def is_mcp_enabled() -> bool:
    """ENABLE_MCP_SERVER_CONFIGURATION 双层校验（默认关）。"""
    import os

    return os.getenv("ENABLE_MCP_SERVER_CONFIGURATION", "false").lower() in (
        "true", "1", "yes", "on",
    )

```

#### code/llm.py

修改内容：完整覆盖：模型超时与重试配置。

```python
"""LLM 工厂：按类型获取已配置的 LLM 实例。

简化自 deepResearch 的 src/llms/llm.py，保留三个核心能力：
1. 从 conf.yaml 读取配置
2. 用 .env 中的 BASIC_MODEL__<key> 环境变量覆盖
3. 缓存实例（同类型只创建一次）

后续章节会扩展：REASONING_MODEL（第2章规划）、EVALUATE_MODEL（第6章评估）。
"""
import logging
import os
from pathlib import Path

import yaml
from langchain_openai import ChatOpenAI

logger = logging.getLogger(__name__)

# 配置文件路径：code/ 目录下的 conf.yaml
_CONF_PATH = Path(__file__).parent / "conf.yaml"

# LLM 类型 → conf.yaml 里的配置块名
_LLM_TYPE_TO_KEY = {
    "basic": "BASIC_MODEL",
    "reasoning": "REASONING_MODEL",
    "evaluate": "EVALUATE_MODEL",
}

# 实例缓存 + token 上限缓存（第7章 ContextManager 用）
_llm_cache: dict[str, ChatOpenAI] = {}
_token_limits: dict[str, int] = {}


def _load_yaml_config() -> dict:
    """读取 conf.yaml。"""
    if not _CONF_PATH.exists():
        logger.warning(f"配置文件不存在: {_CONF_PATH}")
        return {}
    with open(_CONF_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _get_env_overrides(llm_type: str) -> dict:
    """读取 {LLM_TYPE}_MODEL__<key> 格式的环境变量。

    例如 BASIC_MODEL__api_key、BASIC_MODEL__base_url。
    这些变量会覆盖 conf.yaml 里的同名字段。
    """
    prefix = f"{llm_type.upper()}_MODEL__"
    return {
        k[len(prefix):].lower(): v
        for k, v in os.environ.items()
        if k.startswith(prefix)
    }


def get_llm_by_type(llm_type: str = "basic") -> ChatOpenAI:
    """按类型获取 LLM 实例（带缓存）。"""
    if llm_type in _llm_cache:
        return _llm_cache[llm_type]

    config_key = _LLM_TYPE_TO_KEY.get(llm_type)
    if not config_key:
        raise ValueError(f"未知 LLM 类型: {llm_type}，支持: {list(_LLM_TYPE_TO_KEY)}")

    # yaml 配置 + 环境变量覆盖
    yaml_conf = _load_yaml_config().get(config_key, {})
    merged = {**yaml_conf, **_get_env_overrides(llm_type)}

    # token_limit 不传给 ChatOpenAI，单独缓存（第7章用）
    if "token_limit" in merged:
        _token_limits[llm_type] = int(merged.pop("token_limit"))

    # 防御：api_key 必须是字符串（conf.yaml 里不加引号会被解析成 int）
    if "api_key" in merged:
        merged["api_key"] = str(merged["api_key"])

    # 默认重试 3 次，处理限流
    merged.setdefault("max_retries", 3)
    # 本章可观测增量：LLM 调用超时 60s（防卡死；生产按模型调）
    merged.setdefault("timeout", int(os.getenv("LLM_TIMEOUT", "60")))

    if not merged.get("model"):
        raise ValueError(
            f"LLM 类型 '{llm_type}' 未配置 model，请检查 conf.yaml / .env"
        )

    llm = ChatOpenAI(**merged)
    _llm_cache[llm_type] = llm
    logger.info(f"已创建 LLM 实例: type={llm_type}, model={merged['model']}")
    return llm


def get_llm_token_limit(llm_type: str = "basic") -> int | None:
    """获取该类型 LLM 的 token 上限。第7章 ContextManager 用。"""
    # 若还没创建过实例，先尝试填充
    if llm_type not in _token_limits and llm_type not in _llm_cache:
        try:
            get_llm_by_type(llm_type)
        except Exception:
            return None
    return _token_limits.get(llm_type)

```

### 5.5 F+G：研究状态机与 SSE 完整文件

#### code/agents/agents.py

修改内容：完整覆盖：把真实工具上下文交给 researcher 提示词。

```python
"""Agent 工厂：用 langgraph.prebuilt.create_react_agent 创建 ReAct agent。

参考 deepResearch 的 src/agents/agents.py。

ReAct = Reasoning + Acting：LLM 自主决定"思考 → 调用工具 → 观察结果 → 再思考"循环，
直到认为信息足够才给出最终答案（而非像第3章那样固定搜一次）。
这是研究员"自主多轮推理"（该不该再搜、再爬）的能力来源。

pre_model_hook：每次 LLM 调用前触发的钩子。
第4章用 token 观察器（只记录不改）；第7章升级为 ContextManager 压缩器。
"""
from typing import Any, Callable, Optional

from langgraph.prebuilt import create_react_agent

from llm import get_llm_by_type
from prompts.template import apply_prompt_template


def create_agent(
    agent_name: str,
    agent_type: str,
    tools: list,
    prompt_template: str,
    pre_model_hook: Optional[Callable] = None,
    prompt_context: Optional[dict] = None,
) -> Any:
    """创建一个 ReAct agent（带工具 + prompt + pre_model_hook）。

    Args:
        agent_name: agent 名称（如 "researcher" / "coder"）
        agent_type: agent 类型。deepResearch 用 AGENT_LLM_MAP 选不同 LLM；
                    教学版统一用 "basic"，避免引入多模型配置。
        tools: 该 agent 可用的工具列表（LangChain BaseTool）
        prompt_template: prompt 模板名（prompts/<name>.md，不含后缀）
        pre_model_hook: 每次 LLM 调用前的钩子（token 观察器 / 第7章 ContextManager）
    """
    return create_react_agent(
        name=agent_name,
        model=get_llm_by_type("basic"),
        tools=tools,
        prompt=lambda state: apply_prompt_template(
            prompt_template,
            {**state, **(prompt_context or {})},
        ),
        pre_model_hook=pre_model_hook,
    )

```

#### code/prompts/researcher.md

修改内容：完整覆盖：按实际 Web/RAG 工具条件化提示。

```markdown
---
CURRENT_TIME: {{ CURRENT_TIME }}
---

你是 DeepResearch 系统的研究员（researcher），由调度器管理。你通过**自主使用工具**进行彻底调查，而非依赖自己的记忆。

# 当前时间
{{ CURRENT_TIME }}

# 可用工具
{% if has_local_search %}
- **local_search_tool**：从用户启用的私有知识库检索信息
{% endif %}
{% if enable_web_search %}
- **web_search**：联网搜索关键词，返回经去重/过滤/截断清洗的结果
- **crawl_tool**：爬取指定 URL 的正文（markdown 格式，仅用于深挖搜索结果里的具体链接）
{% endif %}

# 工作流程（ReAct：思考 → 行动 → 观察 → 再思考）
1. **理解问题**：仔细阅读当前步骤的"标题"和"描述"，识别要收集什么信息
2. **规划**：决定先搜什么关键词、要不要对某条结果爬取详情
3. **执行**：仅调用上面列出的可用工具进行检索
4. **观察**：看工具返回的结果，判断信息是否足够
5. **循环或合成**：信息不够就再搜（换关键词 / 换英文）；够了就合成最终答案

# 搜索策略（重要）
{% if has_local_search %}
- **私有知识库**：必须使用 `local_search_tool` 检索用户启用的知识库
{% endif %}
{% if enable_web_search %}
- **中英双搜**：先用与问题相同的语言搜一次；再把关键词翻译成英文再搜一次，获取国际来源
{% endif %}
- **禁止编造 URL**：所有 URL 必须来自工具结果，绝不自己捏造
- **时间敏感**：问题涉及"最新/近期/2025"等时，在关键词里加时间限定词

# 输出格式
给出结构化 markdown：
- **研究发现**：按主题（而非按工具）组织，总结关键信息
- **结论**：针对当前步骤的综合回答
- **关键引用**：末尾列出所有来源，格式 `- [标题](URL)`，每条之间空一行

# 注意
- 不要在正文里内联引用，引用集中在末尾「关键引用」
- 用与当前步骤「语言」字段一致的语言输出
- 不要做数学计算（那是 coder 的事），专注资料收集

```

#### code/tools/search.py

修改内容：完整覆盖：Web 搜索成功、空结果都保持 list\[dict\]。

```python
"""搜索工具：标准化结果 + 多引擎 + 三种封装 + 后处理整合。

第3章在第二章极简版基础上的升级：
1. web_search() 返回**标准化**结果（统一字段 type/url/title/content/raw_content/score），
   供 researcher 主线使用；内部接入 SearchResultPostProcessor 做 5 道工序清洗。
2. 多引擎：SEARCH_API 环境变量切换 duckduckgo（默认，免 key）/ tavily（需 key，支持域名黑白名单）/ none（禁用）。
3. 三种工具封装全部展示：
   - @tool 函数式    → crawl_tool / python_repl_tool（见各自文件）
   - BaseTool 子类   → WebSearchTool（本文件）
   - create_logged_tool 工厂 → LoggedWebSearchTool（本文件，给第4章 ReAct agent 用）

参考 deepResearch 的 src/tools/search.py + search_postprocessor.py。
"""
import asyncio
import logging
import os

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from tools.decorators import create_logged_tool
from tools.search_postprocessor import SearchResultPostProcessor

logger = logging.getLogger(__name__)


# ============ 引擎选择 ============

def _get_engine() -> str:
    """读取搜索引擎选择（环境变量 SEARCH_API，默认 duckduckgo）。"""
    return os.getenv("SEARCH_API", "duckduckgo").lower()


# ============ 标准化：把各引擎的原始结果统一成同一字段 ============

def _normalize_ddgs(items: list[dict]) -> list[dict]:
    """ddgs 结果标准化为统一字段。

    ddgs 字段是 title/href/body，且没有相关性 score → 按顺序给递减分数，
    让 SearchResultPostProcessor 的排序/过滤工序仍可工作。
    """

    normalized = [ ]

    for i, it in enumerate(items):
        url = it.get("href") or it.get("url") or ""
        body = it.get("body") or it.get("content") or ""
        normalized.append(
            {
                "type": "page",
                "url": url,
                "title": it.get("title") or "",
                "content": body,
                "raw_content": body,
                "score": round(1.0 - i * 0.1, 2),  # 递减分数（模拟相关性）
            }
        )
    return normalized


def _normalize_tavily(items: list[dict]) -> list[dict]:
    """tavily 结果标准化（tavily 自带 score/url/content/raw_content）。"""

    normalized = [ ]

    for it in items:
        normalized.append(
            {
                "type": "page",
                "url": it.get("url") or "",
                "title": it.get("title") or "",
                "content": it.get("content") or "",
                "raw_content": it.get("raw_content") or "",
                "score": float(it.get("score") or 0.0),
            }
        )
    return normalized



# ============ 各引擎原始搜索（失败一律返回 [ ] ，不抛异常）============


def _ddgs_search(query: str, max_results: int) -> list[dict]:
    """同步 DDGS 调用（供 async 版本通过 to_thread 包裹）。"""
    try:
        from ddgs import DDGS
    except ImportError:
        from duckduckgo_search import DDGS

    with DDGS() as ddgs:
        items = list(ddgs.text(query, max_results=max_results))
    return items


async def _ddgs_search_async(query: str, max_results: int) -> list[dict]:
    """异步 DDGS 搜索：ddgs 9.14.4 无 AsyncDDGS，用 to_thread 把同步调用丢线程池。"""
    try:
        items = await asyncio.to_thread(_ddgs_search, query, max_results)
        logger.info(f"[search] DuckDuckGo 搜到 {len(items)} 条: {query}")
        return _normalize_ddgs(items)
    except Exception as e:
        logger.warning(f"[search] DuckDuckGo 失败（将降级用 LLM 兜底）: {e}")

        return [ ]



async def _tavily_search_async(query: str, max_results: int) -> list[dict]:

    """异步 Tavily 搜索：优先 AsyncTavilyClient，失败/未装则捕获后返回 []。"""

    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        logger.warning("[search] 已选 Tavily 但未配 TAVILY_API_KEY，跳过")

        return [ ]

    try:
        from tavily import AsyncTavilyClient

        # 域名黑白名单（Tavily 独有能力），从环境变量读
        include_domains = _parse_domains(os.getenv("TAVILY_INCLUDE_DOMAINS", ""))
        exclude_domains = _parse_domains(os.getenv("TAVILY_EXCLUDE_DOMAINS", ""))
        client = AsyncTavilyClient(api_key=api_key)
        resp = await client.search(
            query,
            max_results=max_results,
            include_domains=include_domains or None,
            exclude_domains=exclude_domains or None,
        )

        items = resp.get("results", [])

        logger.info(f"[search] Tavily 搜到 {len(items)} 条: {query}")
        return _normalize_tavily(items)
    except Exception as e:
        logger.warning(f"[search] Tavily 失败（将降级用 LLM 兜底）: {e}")

        return [ ]



def _parse_domains(raw: str) -> list[str]:
    """把逗号分隔的域名串解析成列表。"""
    if not raw:

        return [ ]

    return [d.strip() for d in raw.split(",") if d.strip()]


# ============ 主入口：标准化 + 后处理 ============

async def web_search(query: str, max_results: int = 5, apply_postprocess: bool = True) -> list[dict]:

    """执行搜索，返回标准化结果列表（默认经过后处理清洗）。失败返回 []。


    Args:
        query: 搜索关键词
        max_results: 最大结果数
        apply_postprocess: 是否做 5 道工序后处理（默认 True）
    """
    engine = _get_engine()
    if engine in ("none", "off", ""):
        logger.info("[search] 搜索已禁用（SEARCH_API=none）")

        return [ ]


    if engine == "tavily":
        results = await _tavily_search_async(query, max_results)
    else:
        results = await _ddgs_search_async(query, max_results)

    if apply_postprocess and results:
        processor = SearchResultPostProcessor(
            min_score_threshold=float(os.getenv("SEARCH_MIN_SCORE", "0")),
            max_content_length_per_page=int(
                os.getenv("SEARCH_MAX_CONTENT_LEN", "4000")
            ),
        )
        results = processor.process_results(results)
    return results


def format_search_results(results: list[dict], topic: str, locale: str) -> str:
    """把标准化结果格式化为一段 markdown 观察（喂给 reporter）。"""
    lines = [f"# 关于「{topic}」的检索结果（共 {len(results)} 条）"]
    for i, r in enumerate(results, 1):
        title = r.get("title") or "(无标题)"
        url = r.get("url") or ""
        body = r.get("content") or r.get("raw_content") or ""
        score = r.get("score")
        score_str = f"（相关度 {score}）" if score else ""
        lines.append(f"\n## {i}. {title} {score_str}\n\n- 链接：{url}\n- 摘要：{body}\n")
    return "\n".join(lines)


# ============ 三种封装之（二）BaseTool 子类 + （三）create_logged_tool 工厂 ============

class _WebSearchInput(BaseModel):
    """web_search 工具的参数 schema（显式定义，确保 bind_tools 正确传递给 LLM）。"""

    query: str = Field(..., description="搜索关键词，如 'LangGraph 架构'")


def _coerce_query(query: str, kwargs: dict) -> str:
    """从工具调用参数里提取 query，兼容多种格式。

    部分模型（如 Qwen3）的 tool call 会把参数包在 kwargs 里，如：
        {"kwargs": {"query": "..."}} 或 {"kwargs": "..."}
    这里做统一兜底提取，避免 BaseTool 因参数名不匹配而报错。
    """
    if query:
        return query
    kw = kwargs.get("kwargs") if kwargs else None
    if isinstance(kw, dict):
        return kw.get("query") or ""
    if isinstance(kw, str):
        return kw
    if isinstance(kw, list) and kw:
        return str(kw[0])
    if kwargs:
        return next((v for v in kwargs.values() if isinstance(v, str)), "")
    return ""


class WebSearchTool(BaseTool):
    """BaseTool 子类封装：把 web_search 函数包装成 LangChain 工具。

    适合需要持有状态（如 max_results）、自定义描述、被 ReAct agent 调用的场景。
    """

    name: str = "web_search"
    description: str = (
        "Search the web for current information. "
        "用途：联网搜索关键词，返回经过去重/过滤/截断清洗的结构化结果。"
    )
    args_schema: type[BaseModel] = _WebSearchInput  # 显式参数 schema，确保 bind_tools 正确传给 LLM
    max_results: int = 5

    def _run(self, query: str = "", **kwargs) -> list[dict]:
        query = _coerce_query(query, kwargs)
        if not query:

            return [ ]

        # web_search 已 async 化，同步入口用 asyncio.run 兜底（避免遗漏的同步调用点崩溃）
        results = asyncio.run(web_search(query, max_results=self.max_results))
        return results

    async def _arun(self, query: str = "", **kwargs) -> list[dict]:
        # **kwargs 兜底：部分模型（如 Qwen3）的 tool call 会把参数包在 kwargs 里
        query = _coerce_query(query, kwargs)
        if not query:

            return [ ]

        results = await web_search(query, max_results=self.max_results)
        return results


# 工厂封装：给 WebSearchTool 套上输入/输出日志（无需改原类代码）
LoggedWebSearchTool = create_logged_tool(WebSearchTool)


def get_web_search_tool(max_results: int = 5) -> BaseTool:
    """工厂函数：返回带日志的 WebSearchTool 实例（第4章 ReAct agent 用）。"""
    return LoggedWebSearchTool(max_results=max_results)

```

#### code/utils/json\_utils.py

修改内容：完整覆盖：工具消息结构解析。

```python
"""JSON 修复工具：处理 LLM 输出的脏 JSON。

LLM 常输出带 trailing comma、单引号、缺括号、被 markdown 包裹的 JSON。
所有解析 LLM JSON 输出的地方都应包一层 repair_json_output，再 json.loads。
简化自 deepResearch 的 src/utils/json_utils.py。
"""
import logging
from typing import Any

logger = logging.getLogger(__name__)


def sanitize_args(args: Any) -> str:
    """Sanitize tool call arguments to prevent special character issues.

    直接对齐主项目 reference-source/deer-flow-aw/src/utils/json_utils.py。
    前端 merge-message.ts 会在拼接参数前把这些 HTML 实体还原。
    """
    if not isinstance(args, str):
        return ""
    return (
        args.replace("[", "&#91;")
        .replace("]", "&#93;")
        .replace("{", "&#123;")
        .replace("}", "&#125;")
    )


def repair_json_output(content: str) -> str:
    """修复脏 JSON，返回可被 json.loads 的字符串。"""
    if not content:
        return content
    try:
        from json_repair import repair_json

        return repair_json(content)
    except ImportError:
        logger.warning("json_repair 未安装，回退到简单清理（建议 pip install json-repair）")
        return _simple_clean(content)
    except Exception as e:
        logger.warning(f"JSON 修复失败，返回原文: {e}")
        return content


def _simple_clean(content: str) -> str:
    """无 json_repair 时的兜底：去掉 markdown 代码块包裹。"""
    content = content.strip()
    if content.startswith("```"):
        # 去掉首行 ``` 或 ```json
        content = content.split("\n", 1)[1] if "\n" in content else content[3:]
    if content.endswith("```"):
        content = content.rsplit("```", 1)[0]
    return content.strip()

```

#### code/utils/think\_parser.py

修改内容：完整覆盖：跨 chunk 分离 think 与正文。

```python
"""流式 think 状态机：跨 chunk 解析 <think>...</think> 标签。

参考 deepResearch 的 src/utils/think_parser.py（直接移植）。

为什么需要：Qwen3 等推理模型流式输出时，<think>...</think> 可能跨多个 chunk 到达
（如 chunk1="<think>思考"，chunk2="过程</think>正文"）。简单的 clean_think（正则）只能处理
完整文本，流式场景需状态机记住"当前是否在 think 标签内"，跨 chunk 拼接判断。

第7章作为模块提供；第8章 SSE 流式推给前端时用它分离 think / 正文。
"""
from typing import Optional, Tuple


class ThinkContentParser:
    """单条流专用的 think 解析器，跨 chunk 维持状态。"""

    @classmethod
    def get_instance(cls) -> "ThinkContentParser":
        """兼容旧调用名，但每次返回独立实例，避免并发流串状态。"""
        return cls()

    def __init__(self):
        self.in_think = False
        self._buffer = ""

    def reset(self) -> None:
        """重置状态（新的一轮流式开始时调用）。"""
        self.in_think = False
        self._buffer = ""

    def process_chunk(self, chunk_content: str) -> Tuple[str, Optional[str]]:
        """处理单个 chunk，返回 (清理后的正文内容, 提取的 think 内容)。

        跨 chunk 维持 in_think 状态：<think> 和 </think> 可能不在同一 chunk。
        """
        if not chunk_content:
            return "", None

        clean_content = ""
        think_content = ""
        remaining = self._buffer + chunk_content
        self._buffer = ""

        while remaining:
            if not self.in_think:
                # 在正文中：找 <think> 开始
                think_start = remaining.find("<think>")
                if think_start == -1:
                    emitted, self._buffer = self._split_partial_tag(
                        remaining, "<think>"
                    )
                    clean_content += emitted
                    break
                clean_content += remaining[:think_start]
                remaining = remaining[think_start + len("<think>"):]
                self.in_think = True
            else:
                # 在 think 内：找 </think> 结束
                think_end = remaining.find("</think>")
                if think_end == -1:
                    emitted, self._buffer = self._split_partial_tag(
                        remaining, "</think>"
                    )
                    think_content += emitted
                    break
                think_content += remaining[:think_end]
                remaining = remaining[think_end + len("</think>"):]
                self.in_think = False

        return clean_content, (think_content or None)

    @staticmethod
    def _split_partial_tag(text: str, tag: str) -> Tuple[str, str]:
        """保留可能是 tag 前缀的最长尾串，等待下一个 chunk 补全。"""
        max_prefix = min(len(text), len(tag) - 1)
        for size in range(max_prefix, 0, -1):
            if text.endswith(tag[:size]):
                return text[:-size], text[-size:]
        return text, ""

    def flush(self) -> Tuple[str, Optional[str]]:
        """流结束时释放未组成完整标签的缓冲内容。"""
        pending = self._buffer
        self._buffer = ""
        if not pending:
            return "", None
        if self.in_think:
            return "", pending
        return pending, None

```

#### code/graph/builder.py

修改内容：完整覆盖：注册检索审核、直接回答审核和报告审核路由。

```python
"""图构建：评估闭环（步骤评分 + 终评 + reflection loop）。

第6章拓扑（在第5章 HITL 基础上加评估）：
    START → coordinator →(Command)→ planner →(Command)→ human_feedback
    human_feedback →(Command)→ research_team
    research_team →(条件边)→ researcher / coder / eval / reporter
    researcher / coder / eval →(Command)→ research_team
    reporter → report_review →(Command)→ final_report_evaluator / reporter
    final_report_evaluator →(Command)→ __end__ / planner（reflection loop）

continue_to_running_research_team 路由（评估驱动，状态机式）：
    - 有「已完成但未评估」的 RESEARCH step → eval
    - 有未完成 step（execution_res 空，含被 eval 清空的低分重做）→ researcher/coder
    - 全完成 → reporter
final_report_evaluator：报告低分 + plan_iterations < max → planner 重新规划（reflection loop）。
"""
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import START, StateGraph

from config.configuration import Configuration
from graph.nodes import (
    coder_node,
    coordinator_node,
    eval_node,
    final_report_evaluator_node,
    human_feedback_node,
    human_direct_output_node,
    human_retriever_node,
    planner_node,
    report_review_node,
    reporter_node,
    research_team_node,
    researcher_node,
)
from graph.types import State
from prompts.planner_model import Plan, StepType


def continue_to_running_research_team(state, config) -> str:
    """research_team 条件路由：评估驱动（状态机式，不直接改 state）。

    低分重做由 eval_node 清空 execution_res 实现，本函数只读状态。
    """
    current_plan = state.get("current_plan")
    if not isinstance(current_plan, Plan):
        return "reporter"

    # 1. 有「已完成但未评估」的 RESEARCH step → eval
    for step in current_plan.steps:
        if (
            step.execution_res
            and step.step_type == StepType.RESEARCH
            and not step.evaluation_result
        ):
            return "eval"

    # 2. 有未完成 step（execution_res 空）→ 按 step_type 分流
    for step in current_plan.steps:
        if not step.execution_res:
            if step.step_type == StepType.PROCESSING:
                return "coder"
            return "researcher"

    # 3. 全完成 → reporter
    return "reporter"


def build_graph():
    builder = StateGraph(State)

    builder.add_node("coordinator", coordinator_node)
    builder.add_node("planner", planner_node)
    builder.add_node("human_feedback", human_feedback_node)
    builder.add_node("human_retriever", human_retriever_node)
    builder.add_node("human_direct_output", human_direct_output_node)
    builder.add_node("research_team", research_team_node)
    builder.add_node("researcher", researcher_node)
    builder.add_node("coder", coder_node)
    builder.add_node("eval", eval_node)                          # 第6章新增
    builder.add_node("reporter", reporter_node)
    builder.add_node("report_review", report_review_node)
    builder.add_node("final_report_evaluator", final_report_evaluator_node)  # 第6章新增

    builder.add_edge(START, "coordinator")
    # coordinator / planner / human_feedback / report_review / final_report_evaluator 用 Command
    builder.add_conditional_edges(
        "research_team",
        continue_to_running_research_team,
        ["researcher", "coder", "eval", "reporter"],
    )
    builder.add_edge("reporter", "report_review")
    # report_review →(Command)→ final_report_evaluator / reporter
    # final_report_evaluator →(Command)→ __end__ / planner

    memory = MemorySaver()
    return builder.compile(checkpointer=memory)


# 模块级单例
graph = build_graph()

```

#### code/graph/nodes.py

修改内容：完整覆盖：本章所有图状态机修复的完成态。

```python
"""第5章节点：HITL（人机协作）三类 interrupt + 计划内联编辑 + handoff 意图分流。

第5章在第4章 ReAct 基础上加人机协作：
- coordinator：用 handoff_to_planner 伪工具判断意图（闲聊不进研究）
- planner → human_feedback：plan_review interrupt（用户审核/编辑计划）
- reporter → report_review：llm_output_review interrupt（用户确认报告）
- retriever_review：节点齐全（human_retriever_node），开关门控，默认不连入主流程（本章 RAG 增量启用）
- interrupt 必须配 checkpointer（builder.py 加 MemorySaver + thread_id）

参考 deepResearch 的 src/graph/nodes.py（coordinator handoff / human_feedback / human_retriever / llm_output_review）。
"""
import asyncio
import json
import logging
from datetime import datetime
from typing import Annotated
from uuid import uuid4

from langchain_core.messages import AIMessage, HumanMessage, RemoveMessage, ToolMessage
from langgraph.config import get_stream_writer
from langgraph.graph.message import REMOVE_ALL_MESSAGES
from langchain_core.tools import tool
from langgraph.types import Command, interrupt

from agents.agents import create_agent
from config.configuration import Configuration, get_recursion_limit
from config.activities import ActivityType
from graph.commons import clean_think, get_current_step
from graph.types import State
from llm import get_llm_by_type, get_llm_token_limit
from prompts.planner_model import (
    EvaluationRecord,
    EvaluationResponse,
    Plan,
    PlanMinimal,
    StepType,
)
from prompts.template import apply_prompt_template
from tools.crawl import crawl_tool
from tools.python_repl import python_repl_tool
from tools.search import get_web_search_tool
from database import repository
from database.base import SessionLocal
from server.thread_state_manager import thread_state_manager
from utils.context_manager import ContextManager, validate_message_content
from utils.timing import timed_node
from utils.json_utils import repair_json_output

logger = logging.getLogger(__name__)


def _get_param_value(state: State, name: str, default=None):

    for item in state.get("param_list", []) or []:

        if item.get("name") == name:
            return item.get("value", default)
    return default


def _get_effective_retriever_similarity(state: State, config: Configuration) -> float:
    """返回本轮实际使用的阈值：人工修改 > 知识库配置 > 全局默认。"""
    retry_similarity = _get_param_value(state, "human_retriever_similarity", None)
    if retry_similarity is not None:
        try:
            return float(retry_similarity)
        except (TypeError, ValueError):
            pass

    for rag_config in config.rag_configs or []:

        if rag_config.get("platform") == "aihub":
            try:
                return float(rag_config.get("similarity", config.retriever_similarity))
            except (TypeError, ValueError):
                break
    return config.retriever_similarity


# ============ handoff 伪工具（LLM 意图信号）============

@tool
def handoff_to_planner(
    research_topic: Annotated[str, "研究主题，一句话概括"],
    locale: Annotated[str, "用户语言，如 zh-CN / en-US"],
):
    """Handoff to planner agent to do plan.
    伪工具：本身不做事，只作为 LLM 表达"这是研究需求，交给 planner"的信号。
    coordinator 据 tool_calls 是否存在判断意图（研究 vs 闲聊）。
    """
    return


# ============ coordinator（handoff 意图分流）============

async def coordinator_node(state: State, config) -> Command:
    """协调器：bind_tools([handoff_to_planner])，按 LLM 是否调用工具分流意图。

    - 有 tool_call（研究）→ 提取 topic/locale，goto planner
    - 无 tool_call（闲聊）→ 直接回复，goto __end__（final_report = 回复）
    """
    logger.info("[coordinator] 分析用户输入（handoff 模式）")
    messages = apply_prompt_template("coordinator", state)
    response = await get_llm_by_type("basic").bind_tools([handoff_to_planner]).ainvoke(messages)


    msgs = list(state.get("messages", []))


    if response.tool_calls:
        # 研究意图：从 tool_call 参数提取 topic/locale
        locale = state.get("locale", "zh-CN")
        research_topic = state.get("research_topic", "")
        for tc in response.tool_calls:
            if tc.get("name") == "handoff_to_planner":
                args = tc.get("args", {}) or {}
                research_topic = args.get("research_topic") or research_topic
                locale = args.get("locale") or locale
                break
        logger.info(f"[coordinator] 研究意图：主题={research_topic!r}, 语言={locale!r}")
        if response.content:
            msgs.append(HumanMessage(content=clean_think(response.content), name="coordinator"))
        return Command(
            update={"research_topic": research_topic, "locale": locale, "messages": msgs},
            goto="planner",
        )
    else:
        # 闲聊：直接回复，结束流程
        reply = clean_think(response.content) if response.content else "（未识别意图，请明确你的研究需求）"
        logger.info(f"[coordinator] 闲聊，直接回复并结束。回复: {reply[:50]!r}")
        msgs.append(HumanMessage(content=reply, name="coordinator"))
        return Command(update={"final_report": reply, "messages": msgs}, goto="__end__")


# ============ planner（goto human_feedback 做计划审核）============

async def planner_node(state: State, config) -> Command:
    """规划器：拆多步计划，交给 human_feedback 做计划审核（而非直接 research_team）。"""
    configurable = Configuration.from_config(config)
    plan_iterations = state.get("plan_iterations", 0)

    if plan_iterations >= configurable.max_plan_iterations and plan_iterations > 0:
        logger.info(f"[planner] 达到规划上限({configurable.max_plan_iterations})，直接生成报告")
        return Command(goto="reporter")

    plan_state = {**state, "max_step_num": configurable.max_step_num}
    messages = apply_prompt_template("planner", plan_state)

    llm = get_llm_by_type("basic").with_structured_output(PlanMinimal, method="json_schema")
    response = await llm.ainvoke(messages)

    full_response = response.model_dump_json(indent=4, exclude_none=True)
    full_response = clean_think(full_response)

    try:
        curr_plan_dict = json.loads(repair_json_output(full_response))
    except json.JSONDecodeError as e:
        logger.warning(f"[planner] JSON 解析失败: {e}")
        return Command(goto="reporter" if plan_iterations > 0 else "__end__")

    try:
        curr_plan = Plan.model_validate(curr_plan_dict)
    except Exception as e:
        logger.warning(f"[planner] Plan 校验失败: {e}")
        return Command(goto="reporter" if plan_iterations > 0 else "__end__")

    logger.info(f"[planner] 规划完成：{curr_plan.title}（共 {len(curr_plan.steps)} 步）")
    for i, step in enumerate(curr_plan.steps, 1):
        logger.info(f"  步骤{i} [{step.step_type.value}]: {step.title} — {step.description[:40]}")

    # 第5章：计划交给 human_feedback 审核（不再直接 research_team）
    return Command(
        update={
            "current_plan": curr_plan,
            "plan_iterations": plan_iterations + 1,
            "locale": curr_plan.locale,
        },
        goto="human_feedback",
    )


# ============ 计划内联编辑合并 ============

def _merge_plan_edits(original_plan: dict, edited_plan: dict) -> dict:
    """合并用户编辑的计划到原始计划（长度校验，防御性）。

    参考 deepResearch src/graph/nodes.py:_merge_plan_edits。
    """
    if not edited_plan:
        return original_plan

    original_plan["title"] = edited_plan.get("title") or original_plan.get("title", "")
    original_plan["thought"] = edited_plan.get("thought") or original_plan.get("thought", "")


    original_steps = original_plan.get("steps", [])


    edited_steps = edited_plan.get("steps", [])

    # 只有步骤数一致才逐条合并，避免错位
    if edited_steps and len(original_steps) == len(edited_steps):
        for orig, edited in zip(original_steps, edited_steps):
            orig.update(edited)

    return original_plan


# ============ human_feedback（plan_review interrupt）============

async def human_feedback_node(state: State, config) -> Command:
    """计划审核 HITL：interrupt 让用户审核/编辑计划。

    协议：
      [ACCEPTED] → research_team（接受计划，开始研究）
      [EDIT_PLAN] → planner（回规划器重新规划；若 state.edited_plan 有值则合并）
    auto_accepted_plan=True 时跳过 interrupt（CLI 一键模式）。
    """
    current_plan = state.get("current_plan")
    auto_accepted = state.get("auto_accepted_plan", False)
    edited_plan = state.get("edited_plan")

    if not auto_accepted:
        # interrupt：暂停图，等外部 Command(resume=feedback) 恢复
        feedback = interrupt(
            {
                "type": "plan_review",
                "message": "请审核研究计划（[ACCEPTED] 接受 / [EDIT_PLAN] 重新规划）",
                "content": str(current_plan),
            }
        )
        logger.info(f"[human_feedback] 收到计划审核反馈: {feedback!r}")

        fb_upper = str(feedback).upper() if feedback else ""
        if fb_upper.startswith("[EDIT_PLAN]"):
            return Command(
                update={"messages": [HumanMessage(content=str(feedback), name="feedback")]},
                goto="planner",
            )
        elif fb_upper.startswith("[ACCEPTED]"):
            logger.info("[human_feedback] 计划被接受")
        else:
            # 其他输入默认视为接受（CLI 友好）
            logger.info(f"[human_feedback] 反馈 {feedback!r} 视为接受")

    # 解析计划并合并编辑
    plan_iterations = state.get("plan_iterations", 0)
    try:
        if isinstance(current_plan, Plan):
            plan_dict = current_plan.model_dump()
        else:
            plan_dict = json.loads(repair_json_output(str(current_plan)))
        if edited_plan:
            plan_dict = _merge_plan_edits(plan_dict, edited_plan)
        new_plan = Plan.model_validate(plan_dict)
    except Exception as e:
        logger.warning(f"[human_feedback] 计划解析失败: {e}")
        return Command(goto="reporter" if plan_iterations > 1 else "__end__")

    return Command(
        update={
            "current_plan": new_plan,
            "plan_iterations": plan_iterations,
            "locale": new_plan.locale,
        },
        goto="research_team",
    )


async def human_retriever_node(state: State, config) -> Command:
    """审核本轮知识库检索结果；接受后提交缓存结果，修改后重新研究。"""
    current_plan = state.get("current_plan")
    current_step = get_current_step(current_plan)
    review_data = state.get("pending_retrieval_review") or {}
    feedback = interrupt(
        {
            "type": "retriever_review",
            "message": (
                "请审核知识库检索结果；可接受并继续，或修改关键词/阈值后重新检索。"
            ),
            "re_execute_times": getattr(current_step, "step_iterations", 0),
            "review_data": review_data,
        }
    )
    logger.info(f"[human_retriever] 收到检索审核反馈: {feedback!r}")
    if feedback and str(feedback).upper().startswith("[CONTINUE]"):
        pending_result = state.get("pending_execution_res") or ""

        documents = review_data.get("documents") or [ ]

        if not documents:
            return Command(
                update={
                    "messages": [HumanMessage(content=str(feedback), name="feedback")],
                    "pending_retrieval_review": None,

                    "param_list": [],

                },
                goto="human_direct_output",
            )
        if current_step is not None:
            current_step.execution_res = pending_result or "（用户接受空检索结果）"
        return Command(
            update={
                "messages": [HumanMessage(content=str(feedback), name="feedback")],
                "current_plan": current_plan,

                "observations": [pending_result] if pending_result else [],

                "pending_retrieval_review": None,
                "pending_execution_res": None,

                "param_list": [],

            },
            goto="research_team",
        )
    return Command(
        update={
            "pending_retrieval_review": None,
            "pending_execution_res": None,
        },
        goto="researcher",
    )


async def human_direct_output_node(state: State, config) -> Command:
    """无背景资料审核：确认是否保留模型直接回答。

    业务语义对齐原项目 llm_output_review / direct_output，
    但使用本章已有的 pending_execution_res，避免 resume 时重复执行 agent。
    """
    current_plan = state.get("current_plan")
    current_step = get_current_step(current_plan)
    feedback = interrupt(
        {
            "type": "llm_output_review",
            "message": "当前没有检索到背景知识，是否保留模型直接回答？",
            "re_execute_times": getattr(current_step, "step_iterations", 0),
        }
    )
    direct_output = str(
        _get_param_value(state, "direct_output", "false")
    ).lower() == "true"
    pending_result = state.get("pending_execution_res") or ""
    execution_result = (
        pending_result if direct_output else "Empty research result."
    )
    if current_step is not None:
        current_step.execution_res = execution_result
    logger.info(
        f"[human_direct_output] 用户选择 direct_output={direct_output}: {feedback!r}"
    )
    return Command(
        update={
            "messages": [HumanMessage(content=str(feedback), name="feedback")],
            "current_plan": current_plan,
            "observations": [execution_result],
            "pending_execution_res": None,
            "pending_retrieval_review": None,

            "param_list": [],

        },
        goto="research_team",
    )


# ============ research_team（空枢纽）============

async def research_team_node(state: State) -> dict:
    current_plan = state.get("current_plan")

    steps = getattr(current_plan, "steps", []) or [ ]

    done = sum(1 for s in steps if s.execution_res)
    logger.info(f"[research_team] 调度研究团队（进度 {done}/{len(steps)}）")
    return {}


# ============ pre_model_hook：token 观察器（沿用第4章）============

def make_context_manager_hook(agent_name: str, preserve: int = 3):
    """创建上下文管理 pre_model_hook：超限压缩 + 7 重校验（第7章升级，替换第4章 token 观察器）。

    第4章的 pre_model_hook 只观察 token；第7章实际压缩：
    - validate_message_content 7 重校验（防 None/list/dict content 崩溃）
    - ContextManager.compress_messages 超限时滑动窗口压缩（保前缀 + 尾部回填 + 截断）
    未配 token_limit 时退化为观察器（不压缩，仅记录）。
    作为 create_react_agent 的 pre_model_hook，每次 LLM 调用前触发。
    """
    token_limit = get_llm_token_limit("basic")
    if not token_limit:
        logger.warning(
            f"[context_manager/{agent_name}] 未配 token_limit，上下文压缩失效（仅观察）"
        )
        return _make_observer_only_hook(agent_name)

    cm = ContextManager(token_limit, preserve)

    def hook(state):

        messages = state.get("messages", [])

        before = cm.count_tokens(messages)
        # 7 重校验（防 None / list / dict content 把 LLM 调用搞崩）
        messages = validate_message_content(messages)
        # 超限压缩
        new_messages = cm.compress_messages({"messages": messages})["messages"]
        after = cm.count_tokens(new_messages)
        if before != after:
            logger.info(
                f"[context_manager/{agent_name}] 压缩: {before} -> {after} tokens "
                f"(limit={token_limit}, 消息 {len(messages)}->{len(new_messages)})"
            )
        else:
            logger.info(
                f"[context_manager/{agent_name}] {after} tokens / {len(new_messages)} 条 "
                f"(limit={token_limit}, 未超限)"
            )
        return {"messages": [RemoveMessage(id=REMOVE_ALL_MESSAGES), *new_messages]}

    return hook


def _make_observer_only_hook(agent_name: str):
    """token 观察器（无 token_limit 时的退化 hook，只记录不压缩）。"""

    def hook(state):

        messages = state.get("messages", [])

        total_chars = sum(len(str(getattr(m, "content", ""))) for m in messages)
        logger.info(
            f"[observer/{agent_name}] 消息数={len(messages)}, 估算token≈{int(total_chars / 2.5)}"
        )
        return {}

    return hook


# ============ ReAct 执行（researcher / coder，沿用第4章）============

def _log_node_event(thread_id: str, node: str, payload: dict, level: str = "info") -> None:
    """记录节点事件到业务表（业务可观测，第9章）。无 thread_id 或落库失败则跳过。"""
    if not thread_id:
        return
    db = None
    try:
        db = SessionLocal()
        repository.log_graph_event(db, thread_id, node, payload, level)
    except Exception as e:
        logger.warning(f"[log_event] 节点事件落库失败（不影响流程）: {e}")
    finally:
        if db is not None:
            db.close()


async def _finish_skipped_retry(
    current_step,
    current_plan,
    configurable: Configuration,
    thread_id: str,
    agent_name: str,
    phase: str,
) -> Command:
    """放弃当前重试，恢复最近一次完整结果，并阻止该步骤再次进入评估。"""
    previous_result = current_step.last_execution_res
    previous_evaluation = current_step.last_evaluation_result
    if not previous_result:
        previous_result = current_step.execution_res or "（用户跳过本轮重试；无可恢复结果）"
    if not previous_evaluation:
        previous_evaluation = {
            "quality_score": 0.0,
            "feedback": "用户跳过后续重试，保留最近一次可用结果。",
            "skipped_retry": True,
        }

    current_step.execution_res = previous_result
    current_step.evaluation_result = previous_evaluation
    current_step.step_iterations = max(
        current_step.step_iterations,
        configurable.max_step_iterations + 1,
    )
    thread_state_manager.set_skip_state(thread_id, False)
    await asyncio.to_thread(
        _log_node_event,
        thread_id,
        agent_name,
        {"action": "skip_retry", "step": current_step.title, "phase": phase},
    )
    logger.info(
        f"[{agent_name}] 已跳过当前重试并保留上次结果: {current_step.title!r}"
    )
    # 上次结果在首次执行完成时已经进入 observations，不重复追加。
    return Command(update={"current_plan": current_plan}, goto="research_team")


async def _execute_agent_step(state, agent, agent_name, config) -> Command:
    """用 ReAct agent 执行当前步骤（流式 astream）。沿用第4章实现。"""
    current_plan = state.get("current_plan")
    if not isinstance(current_plan, Plan):
        return Command(goto="research_team")

    current_step = get_current_step(current_plan)
    if not current_step:
        return Command(goto="research_team")
    runtime_config = Configuration.from_config(config)

    # 契约对齐主项目 reference-source/deer-flow-aw/src/graph/nodes.py:1020-1029：
    # 首次进入该步骤时，先向 state 写入 step / step_title 再回 research_team。
    # 前端 research-activities-block 按 message.step 分组渲染 activities 卡片，
    # step 空的话所有节点消息都挤在同一桶里，eval 卡片位置错乱、re_execute 计数异常。
    # 用 step_command != state.step 判断"首次"，避免 skip 后回来第二次进入无限刷 step。
    try:
        step_index = current_plan.steps.index(current_step)
        step_command = f"step{step_index}"
    except ValueError:
        step_command = ""
    if step_command and state.get("step", "") != step_command:
        return Command(
            update={
                "step": step_command,
                "step_title": current_step.title,
                "current_plan": current_plan,
            },
            goto="research_team",
        )

    # 第9章：skip 检查（前端 POST /api/chat/skip 设置，跳过当前步但 graph 继续跑下一步）
    configurable = (config or {}).get("configurable", {}) if isinstance(config, dict) else {}
    thread_id = configurable.get("thread_id", "")
    if thread_id and thread_state_manager.get_skip_state(thread_id):
        if current_step.step_iterations >= 1:
            return await _finish_skipped_retry(
                current_step,
                current_plan,
                runtime_config,
                thread_id,
                agent_name,
                phase="before_running",
            )
        # skip 只允许用于低分重试，防止直接调用 API 跳过首次执行。
        thread_state_manager.set_skip_state(thread_id, False)
        logger.warning(f"[{agent_name}] 忽略首次执行阶段的 skip 请求")

    completed_steps = [s for s in current_plan.steps if s.execution_res and s != current_step]
    locale = state.get("locale", "zh-CN")
    logger.info(f"[{agent_name}] ReAct 执行步骤: {current_step.title!r}")

    completed_info = ""
    if completed_steps:
        completed_info = "# 已完成步骤\n\n"
        for i, s in enumerate(completed_steps, 1):
            completed_info += f"## 步骤{i}: {s.title}\n<finding>\n{s.execution_res}\n</finding>\n\n"

    agent_input = {
        "messages": [
            HumanMessage(
                content=(
                    f"# 研究主题\n\n{current_plan.title}\n\n{completed_info}"
                    f"# 当前步骤\n\n## 标题\n{current_step.title}\n\n"
                    f"## 描述\n{current_step.description}\n\n## 语言\n{locale}"
                )
            )
        ]
    }
    if agent_name == "researcher":
        agent_input["messages"].append(
            HumanMessage(
                content="重要：不要在正文里内联引用，来源集中在末尾「关键引用」，格式 - [标题](URL)。",
                name="system",
            )
        )
        retry_query = _get_param_value(state, "human_retriever_query", "")
        if retry_query:
            agent_input["messages"].append(
                HumanMessage(
                    content=f"用户要求本轮知识库检索优先使用关键词：{retry_query}",
                    name="system",
                )
            )
        previous_feedback = next(
            (
                record.feedback

                for record in reversed(state.get("evaluation_history", []) or [])

                if record.step_title == current_step.title and record.feedback
            ),
            "",
        )
        if current_step.step_iterations > 0 and previous_feedback:
            agent_input["messages"].append(
                HumanMessage(
                    content=f"这是重试执行。请针对上次评估反馈逐项改进：\n{previous_feedback}",
                    name="system",
                )
            )
        if runtime_config.enable_web_search:
            agent_input["messages"].append(
                HumanMessage(
                    content="重要：先用原语言搜索，再翻译成英文搜索一次。禁止编造 URL。",
                    name="system",
                )
            )

    recursion_limit = get_recursion_limit(default=25)

    messages = [ ]

    chunk_count = 0
    skip_requested = False
    retrieval_review = None
    has_background_knowledge = False
    async for chunk in agent.astream(
        agent_input, config={"recursion_limit": recursion_limit}, stream_mode="values"
    ):
        chunk_count += 1
        if (
            thread_id
            and current_step.step_iterations >= 1
            and thread_state_manager.get_skip_state(thread_id)
        ):
            skip_requested = True
            break
        if not isinstance(chunk, dict):
            continue

        msgs = chunk.get("messages", [])

        if not msgs:
            continue
        latest = msgs[-1]
        if isinstance(latest, HumanMessage):
            continue
        messages.append(latest)
        if agent_name == "researcher" and isinstance(latest, ToolMessage):
            for earlier in reversed(messages[:-1]):
                matched_call = next(
                    (
                        call

                        for call in getattr(earlier, "tool_calls", []) or [ ]

                        if call.get("id") == latest.tool_call_id
                    ),
                    None,
                )
                if matched_call is None:
                    continue
                if matched_call.get("name") == "local_search_tool":
                    try:
                        documents = (
                            latest.content
                            if isinstance(latest.content, list)
                            else json.loads(latest.content)
                        )
                    except (json.JSONDecodeError, TypeError):

                        documents = [ ]

                    retrieval_review = {
                        "query": (
                            _get_param_value(state, "human_retriever_query", "")
                            or matched_call.get("args", {}).get("keywords", "")
                        ),
                        "similarity": _get_effective_retriever_similarity(
                            state, runtime_config
                        ),

                        "documents": documents if isinstance(documents, list) else [],

                    }
                    has_background_knowledge = (
                        has_background_knowledge
                        or bool(retrieval_review["documents"])
                    )
                else:
                    tool_content = latest.content
                    if isinstance(tool_content, list):
                        has_background_knowledge = (
                            has_background_knowledge or bool(tool_content)
                        )
                    elif tool_content is not None:
                        normalized_content = str(tool_content).strip()
                        has_background_knowledge = (
                            has_background_knowledge

                            or normalized_content not in ("", "[]")

                        )
                break
    if skip_requested:
        return await _finish_skipped_retry(
            current_step,
            current_plan,
            runtime_config,
            thread_id,
            agent_name,
            phase="running",
        )
    logger.info(
        f"[{agent_name}] astream 结束：{chunk_count} 个 chunk，累积 {len(messages)} 条非 Human 消息"
    )

    # 提取最终回复（层层兜底）
    response_content = ""
    for msg in reversed(messages):
        if isinstance(msg, AIMessage) and msg.content and not getattr(msg, "tool_calls", None):
            response_content = msg.content
            break
    if not response_content:
        for msg in reversed(messages):
            if isinstance(msg, AIMessage) and msg.content:
                response_content = msg.content
                break
    response_content = clean_think(response_content)
    if not response_content.strip():
        for msg in reversed(messages):
            content = getattr(msg, "content", "")
            if content and not isinstance(msg, HumanMessage):
                response_content = str(content)
                logger.warning(f"[{agent_name}] 最终回复为空，用最后一条工具结果兜底")
                break
    if not response_content.strip():
        response_content = f"（{agent_name} 未产出有效结果）"

    if retrieval_review is not None:
        return Command(
            update={
                "current_plan": current_plan,
                "pending_retrieval_review": retrieval_review,
                "pending_execution_res": response_content,
            },
            goto="human_retriever",
        )

    if agent_name == "researcher" and not has_background_knowledge:
        return Command(
            update={
                "current_plan": current_plan,
                "pending_execution_res": response_content,
            },
            goto="human_direct_output",
        )

    current_step.execution_res = response_content
    logger.info(f"[{agent_name}] 步骤完成: {current_step.title!r}（结果 {len(response_content)} 字）")
    await asyncio.to_thread(
        _log_node_event,
        thread_id, agent_name,
        {"action": "execute", "step": current_step.title, "result_len": len(response_content)},
    )
    return Command(
        update={"current_plan": current_plan, "observations": [response_content]},
        goto="research_team",
    )


async def _setup_and_execute_agent_step(state, config, agent_type, default_tools) -> Command:
    # 本章 MCP 增量：动态工具加载（配置 mcp_settings 且该 agent 在 add_to_agents 时）
    tools = list(default_tools)  # 浅拷贝，防污染默认工具列表
    configurable = Configuration.from_config(config)
    mcp_settings = configurable.mcp_settings if configurable else None
    if mcp_settings and isinstance(mcp_settings, dict) and mcp_settings.get("servers"):
        enabled_servers = {}
        for name, sc in mcp_settings["servers"].items():

            if sc.get("enabled_tools") and agent_type in sc.get("add_to_agents", []):

                enabled_servers[name] = {
                    k: v for k, v in sc.items()
                    if k in ("transport", "command", "args", "url", "env", "headers")
                }
        if enabled_servers:
            from server.mcp_utils import load_mcp_tools
            mcp_tools = await load_mcp_tools(enabled_servers)
            # 工具来源标注（审计：知道工具来自哪个 MCP server）
            for t in mcp_tools:
                src = next(
                    (n for n, s in enabled_servers.items()

                     if t.name in s.get("enabled_tools", [])),

                    "mcp",
                )
                t.description = f"Powered by '{src}'.\n{t.description}"
            tools.extend(mcp_tools)
            logger.info(f"[{agent_type}] 已加载 {len(mcp_tools)} 个 MCP 工具")

    pre_model_hook = make_context_manager_hook(agent_type)
    tool_names = {getattr(tool, "name", "") for tool in tools}
    agent = create_agent(
        agent_type,
        agent_type,
        tools,
        agent_type,
        pre_model_hook,
        prompt_context={
            "enable_web_search": configurable.enable_web_search,
            "enable_rag": configurable.enable_rag,
            "has_local_search": "local_search_tool" in tool_names,
        },
    )
    return await _execute_agent_step(state, agent, agent_type, config)


@timed_node
async def researcher_node(state: State, config) -> Command:
    current_plan = state.get("current_plan")
    if not isinstance(current_plan, Plan):
        return Command(goto="research_team")
    if not get_current_step(current_plan):
        return Command(goto="research_team")
    configurable = Configuration.from_config(config)

    tools = [ ]

    if configurable.enable_web_search:
        tools.extend(
            [get_web_search_tool(max_results=configurable.max_search_results), crawl_tool]
        )
    # 本章 RAG 增量：配置 resources 时加 local_search_tool（RAG-web 协同）
    if configurable.enable_rag and (configurable.resources or configurable.rag_configs):
        from rag.builder import build_retriever_by_configs
        from tools.retriever import make_local_search_tool
        retry_similarity = _get_param_value(
            state, "human_retriever_similarity", None
        )
        retrievers = build_retriever_by_configs(
            configurable.resources,
            enabled_configs=configurable.rag_configs,
            similarity=float(
                retry_similarity
                if retry_similarity is not None
                else configurable.retriever_similarity
            ),
            retriever_keyword=str(
                _get_param_value(state, "human_retriever_query", "")
            ),
            override_similarity=retry_similarity is not None,
        )
        if retrievers:
            resources = [
                resource
                for retriever in retrievers
                for resource in retriever.list_resources()
            ]
            tools.append(make_local_search_tool(retrievers, resources))
            logger.info(

                f"[researcher] 已加载 local_search_tool（resources={len(configurable.resources or [])}, "


                f"rag_configs={len(configurable.rag_configs or [])}）"

            )
    return await _setup_and_execute_agent_step(state, config, "researcher", tools)


@timed_node
async def coder_node(state: State, config) -> Command:
    current_plan = state.get("current_plan")
    if not isinstance(current_plan, Plan):
        return Command(goto="research_team")
    if not get_current_step(current_plan):
        return Command(goto="research_team")
    return await _setup_and_execute_agent_step(state, config, "coder", [python_repl_tool])


# ============ reporter（生成报告）============

@timed_node
async def reporter_node(state: State, config) -> dict:
    """报告员：综合每个步骤最终保留的结果生成 markdown 报告。"""
    locale = state.get("locale", "zh-CN")
    current_plan = state.get("current_plan")
    observations = (
        [step.execution_res for step in current_plan.steps if step.execution_res]
        if isinstance(current_plan, Plan)

        else state.get("observations", [])

    )
    logger.info(f"[reporter] 撰写报告，共 {len(observations)} 条观察")

    obs_text = "\n\n---\n\n".join(
        f"【观察 {i + 1}】\n{o}" for i, o in enumerate(observations)
    )
    input_state = {
        "locale": locale,
        "messages": [HumanMessage(content=f"# 研究观察资料\n\n{obs_text}")],
    }
    messages = apply_prompt_template("reporter", input_state)
    report_style = Configuration.from_config(config).report_style
    if report_style:
        messages.append(
            HumanMessage(
                content=f"请使用用户选择的报告风格撰写：{report_style}",
                name="system",
            )
        )
    response = await get_llm_by_type("basic").ainvoke(messages)
    report = clean_think(response.content)
    logger.info("[reporter] 报告生成完成")
    return {"final_report": report}


# ============ report_review（最终报告审核 interrupt）============

async def report_review_node(state: State, config) -> Command:
    """报告审核 HITL：interrupt 让用户确认报告。

    协议：
      [ACCEPTED] → final_report_evaluator（进入终评）
      [CONTINUE] → reporter（重新生成）
    auto_accepted_plan=True 时跳过（--auto 模式，直接进终评）。
    """
    if state.get("auto_accepted_plan", False):
        return Command(goto="final_report_evaluator")
    feedback = interrupt(
        {
            "type": "report_review",
            "message": "报告已生成，请确认（[ACCEPTED] 接受 / [CONTINUE] 重新生成）",
        }
    )
    logger.info(f"[report_review] 收到报告审核反馈: {feedback!r}")
    if feedback and str(feedback).upper().startswith("[CONTINUE]"):
        return Command(goto="reporter")
    # [ACCEPTED] 或默认 → 进入终评
    return Command(goto="final_report_evaluator")


# ============ eval（步骤评分，第6章新增）============

async def eval_node(state: State, config) -> Command:
    """评估节点：找最近完成但未评估的 RESEARCH step，打分。

    低分重做由 continue_to_running_research_team 路由驱动（非本节点）。
    注意 step_iterations 在 eval 递增（不是 researcher），防止"研究→评估"循环无限。
    """
    # 直接沿用原项目的 custom stream：评估模型工作期间，前端先看到“评估研究结果”。
    writer = get_stream_writer()
    writer(
        (
            AIMessage(
                content=ActivityType.EVALUATE_RESEARCH.description,
                additional_kwargs={
                    "activity": {
                        "activity_type": ActivityType.EVALUATE_RESEARCH.type,
                        "activity_name": ActivityType.EVALUATE_RESEARCH.description,
                    }
                },
                id="run--" + uuid4().hex,
            ),
            (config or {}).get("metadata", {}),
        )
    )

    current_plan = state.get("current_plan")
    if not isinstance(current_plan, Plan):
        return Command(goto="research_team")

    target = None
    for step in current_plan.steps:
        if (
            step.execution_res
            and step.step_type == StepType.RESEARCH
            and not step.evaluation_result
        ):
            target = step
            break

    if not target:
        logger.info("[eval] 无待评估的研究步骤")
        return Command(goto="research_team")

    logger.info(f"[eval] 评估步骤: {target.title!r}")
    configurable = Configuration.from_config(config)
    result = await _evaluate_research_step(target, state)
    retry_count = target.step_iterations
    target.step_iterations += 1  # 重做计数在 eval 递增（不是 researcher）

    score = result.get("quality_score", 0.0)
    feedback = result.get("feedback", "")
    logger.info(f"[eval] 步骤 {target.title!r} 评分 {score:.2f}：{feedback[:60]}")

    # 低分且未超重做上限 → 清空结果，待 researcher 重做；否则保留评估结果
    if (
        score < configurable.min_quality_score
        and target.step_iterations <= configurable.max_step_iterations
    ):
        logger.info(
            f"[eval] 低分 {score:.2f} < {configurable.min_quality_score}，"
            f"清空结果待重做（第 {target.step_iterations} 次）"
        )
        # 重试前保存最近一次完整结果；用户点击“跳过执行”时恢复该快照，
        # 表示放弃继续优化而不是把“已跳过”当作新结果再次评估。
        target.last_execution_res = target.execution_res
        target.last_evaluation_result = result
        target.execution_res = None
        target.evaluation_result = None
    else:
        target.evaluation_result = result
        target.last_execution_res = None
        target.last_evaluation_result = None
        if score < configurable.min_quality_score:
            logger.info(
                f"[eval] 低分但已达重做上限({target.step_iterations}>{configurable.max_step_iterations})，保留结果"
            )

    record = EvaluationRecord(
        step_title=target.title,
        step_type=target.step_type.value,
        quality_score=score,
        feedback=feedback,
        evaluator_name="evaluator",
    )
    evaluation_message = AIMessage(
        content="研究步骤评估结果",
        name="evaluator",
        additional_kwargs={
            "event_type": "evaluation",
            "evaluation_data": {
                "step_id": f"step_{hash(target.title)}",
                "step_title": target.title,
                "step_type": target.step_type.value,
                "quality_score": score,
                "feedback": feedback,
                "evaluation_timestamp": record.evaluation_timestamp.isoformat(),
                "evaluator_name": "evaluator",
                "evaluation_status": "completed",
            },
            # 首次执行为 0；第一次重试期间为 1。调度计数在上方另行递增。
            "re_execute_times": retry_count,
        },
    )
    evaluation_message.response_metadata = {"finish_reason": "stop"}
    return Command(
        update={
            "messages": [evaluation_message],
            "current_plan": current_plan,
            "evaluation_history": [record],
        },
        goto="research_team",
    )


async def _evaluate_research_step(step, state) -> dict:
    """评估单个研究步骤质量（structured_output + 3 次重试 + clamp [0,1]）。

    参考 deepResearch src/graph/nodes.py:_evaluate_research_step。
    """
    prompt = f"""请评估以下研究步骤的执行质量：

研究主题: {state.get("research_topic", "未知")}
步骤标题: {step.title}
步骤描述: {step.description}
执行结果: {step.execution_res}

评估维度：内容完整性、信息准确性、来源可靠性、相关性、深度与广度。
请返回总体质量评分 (0-1) 和简洁的改进建议（中文，最多 3 条）。

要求：
- 直接返回 JSON，不要返回无关内容
- quality_score 必须是 0~1 之间的小数（如 0.7），不要用百分制
- 返回格式：{{"quality_score": 0.7, "feedback": "1. 改进建议一 2. 改进建议二"}}
"""
    max_retries = 3
    for attempt in range(1, max_retries + 1):
        try:
            llm = get_llm_by_type("basic").with_structured_output(
                EvaluationResponse, method="json_schema"
            )
            resp = await llm.ainvoke([HumanMessage(content=prompt)])
            data = json.loads(repair_json_output(resp.model_dump_json(exclude_none=True)))
            score = float(data.get("quality_score", 0.01))
            if score > 1.0:
                score = score / 100.0  # LLM 返回百分制（如 80）时归一化到 0-1
            return {
                "quality_score": min(max(score, 0.0), 1.0),  # clamp 兜底越界
                "feedback": data.get("feedback", "无具体反馈"),
            }
        except Exception as e:
            logger.error(f"[eval] 评估第 {attempt}/{max_retries} 次失败: {e}")
    return {"quality_score": 0.0, "feedback": "评估过程出错"}


# ============ final_report_evaluator（终评 + reflection loop，第6章新增）============

async def final_report_evaluator_node(state: State, config) -> Command:
    """终评节点：评估最终报告质量。

    reflection loop：评分低于 min_quality_score 且 plan_iterations < max_plan_iterations
    → 回 planner 重新规划（评估驱动重规划）；否则 → __end__。
    """
    final_report = state.get("final_report", "")
    if not final_report:
        logger.warning("[final_eval] 无报告可评估，结束")
        return Command(goto="__end__")

    logger.info("[final_eval] 评估最终报告")
    result = await _evaluate_final_report(final_report, state)
    score = result.get("quality_score", 0.0)
    feedback = result.get("feedback", "")
    logger.info(f"[final_eval] 报告评分 {score:.2f}：{feedback[:80]}")

    record = EvaluationRecord(
        step_title="最终报告",
        step_type="final_report",
        quality_score=score,
        feedback=feedback,
        evaluator_name="final_evaluator",
    )

    # 构造 evaluation_data 塞进 AIMessage.additional_kwargs（对齐主项目 deer-flow-aw 做法）：
    # 让 messages 流自然吐出这条 AIMessage，server 侧 _process_message_chunk 识别
    # agent_name == "final_report_evaluator" 后从 additional_kwargs 提取 evaluation_data，
    # 推 event: evaluation 给前端。数据源单点在节点，server 只做转发。
    evaluation_message = AIMessage(
        content="最终报告评估结果",
        name="final_report_evaluator",
        additional_kwargs={
            "event_type": "final_report_evaluation",
            "evaluation_data": {
                "step_id": "final_report",
                "step_title": "最终报告",
                "step_type": "final_report",
                "quality_score": score,
                "feedback": feedback,
                "evaluation_timestamp": record.evaluation_timestamp.isoformat(),
                "evaluator_name": "final_evaluator",
                "evaluation_status": "completed",
            },
        },
    )
    # finish_reason=stop 触发前端 store 里 isStreaming=false + 数据持久化
    evaluation_message.response_metadata = {"finish_reason": "stop"}

    update = {
        "messages": [evaluation_message],
        "evaluation_history": [record],
        "final_report_evaluation": {"quality_score": score, "feedback": feedback},
    }

    configurable = Configuration.from_config(config)
    plan_iterations = state.get("plan_iterations", 0)
    if score < configurable.min_quality_score and plan_iterations < configurable.max_plan_iterations:
        logger.info(
            f"[final_eval] 报告评分 {score:.2f} < {configurable.min_quality_score}，"
            f"回 planner 重新规划（reflection loop）"
        )
        return Command(update=update, goto="planner")

    return Command(update=update, goto="__end__")


async def _evaluate_final_report(report: str, state) -> dict:
    """评估最终报告（structured_output + 重试）。"""
    prompt = f"""请评估以下研究报告的质量：

研究主题: {state.get("research_topic", "未知")}
报告内容:
{report[:3000]}

评估维度：结构完整性、内容准确性、引用可靠性、分析深度、可读性。
请返回总体质量评分 (0-1) 和改进建议（中文）。

要求：
- 直接返回 JSON，不要返回无关内容
- quality_score 必须是 0~1 之间的小数（如 0.85），不要用百分制
- 返回格式：{{"quality_score": 0.85, "feedback": "优点与改进建议"}}
"""
    for attempt in range(1, 4):
        try:
            llm = get_llm_by_type("basic").with_structured_output(
                EvaluationResponse, method="json_schema"
            )
            resp = await llm.ainvoke([HumanMessage(content=prompt)])
            data = json.loads(repair_json_output(resp.model_dump_json(exclude_none=True)))
            score = float(data.get("quality_score", 0.01))
            if score > 1.0:
                score = score / 100.0  # LLM 返回百分制时归一化到 0-1
            return {
                "quality_score": min(max(score, 0.0), 1.0),  # clamp 兜底越界
                "feedback": data.get("feedback", "无具体反馈"),
            }
        except Exception as e:
            logger.error(f"[final_eval] 评估第 {attempt}/3 次失败: {e}")
    return {"quality_score": 0.0, "feedback": "终评过程出错"}

```

#### code/server/app.py

修改内容：完整覆盖：请求配置、SSE、HITL、skip、RAG/MCP API 的完成态。

```python
"""第8章 FastAPI 服务：SSE 流式 + 会话生命周期。

从脚本变服务的关键一章。SSE 五层链（简化自 deepResearch server/app.py）：
  1. /api/chat/stream        —— 端点，返回 StreamingResponse(text/event-stream)
  2. _astream_workflow_generator —— 生成器主循环（回显输入 + resume + 调五层链）
  3. _stream_graph_events     —— graph.astream(stream_mode=["messages","updates"], subgraphs=True)
  4. _process_message_chunk   —— chunk → SSE 事件（message_chunk/tool_calls/tool_call_result/interrupt/error）
  5. _make_event              —— 打 SSE 帧（event: X\ndata: {json}\n\n）+ 落库

会话生命周期：业务表 ChatStream（对话全文分片）+ LanggraphEvent（节点事件流水）。
vs checkpointer：业务表存"产品可见的结构化数据"（刷新/重启可回看），checkpointer 存"开发态 resume 状态"。
"""
import json
import logging
import os
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, StreamingResponse
from langchain_core.messages import AIMessageChunk, HumanMessage, ToolMessage
from langgraph.types import Command
from sqlalchemy.orm import Session

from config.configuration import get_recursion_limit
from config.activities import ActivityType
from database import repository
from database.base import SessionLocal, get_db, init_db
from graph.builder import graph
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg_pool import AsyncConnectionPool
from server.chat_request import ChatRequest, SkipRequest
from server.mcp_utils import is_mcp_enabled, load_mcp_tools
from server.rag_config_service import rag_config_service
from server.rag_request import RAGConfigPayload, RAGConnectionPayload
from server.thread_state_manager import thread_state_manager
from utils.json_utils import sanitize_args
from utils.think_parser import ThinkContentParser

logger = logging.getLogger(__name__)

_checkpoint_pool: AsyncConnectionPool | None = None

app = FastAPI(title="mini-deepresearch", version="0.8.0")
cors_origins = [origin.strip() for origin in os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if origin.strip()]

# CORS：前端跨域（生产应收敛白名单）
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup():
    init_db()
    global _checkpoint_pool
    _checkpoint_pool = AsyncConnectionPool(
        conninfo=os.getenv("CHECKPOINT_DB_URL"),
        kwargs={"autocommit": True, "prepare_threshold": 0},
        min_size=2,
        max_size=10,
        open=False,
    )
    await _checkpoint_pool.open()
    saver = AsyncPostgresSaver(_checkpoint_pool)
    await saver.setup()
    graph.checkpointer = saver
    logger.info("checkpointer: AsyncPostgresSaver 已挂载到 graph")


@app.on_event("shutdown")
async def _shutdown():
    global _checkpoint_pool
    if _checkpoint_pool:
        await _checkpoint_pool.close()
        _checkpoint_pool = None
        logger.info("checkpointer: 连接池已关闭")


# ============ 1. chat_stream 端点 ============

@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    """聊天流式端点：逐事件 SSE 推送。"""
    # 本章 MCP 增量：安全开关（默认关，避免任意命令执行风险）
    if request.mcp_settings and not is_mcp_enabled():
        raise HTTPException(
            status_code=403,
            detail="MCP 未启用，设 ENABLE_MCP_SERVER_CONFIGURATION=true",
        )
    thread_id = request.thread_id or str(uuid4())
    return StreamingResponse(
        _astream_workflow_generator(request, thread_id),
        media_type="text/event-stream",
    )


# ============ 2. _astream_workflow_generator（生成器主循环）============

async def _astream_workflow_generator(request: ChatRequest, thread_id: str):
    """组装 workflow_input（含 HITL resume）→ 调五层链。

    注意：user 消息不主动 yield 回前端——前端 sendMessage 已本地 append user 气泡（无延迟感），
    再 yield 会让前端追加两条相同气泡（重复渲染）。但仍调 _make_event 把 user 消息**落业务表**，
    让 GET /api/conversation/{thread_id} 历史回放时能重放完整对话（含用户提问）。
    对齐主项目 deer-flow-aw/src/server/app.py 的 _process_initial_messages 做法。
    """
    # user 消息只落库不 yield（避免与前端本地 append 重复）
    for msg in request.messages:
        if isinstance(msg, dict) and msg.get("content"):
            _make_event(
                "message_chunk",
                {
                    "thread_id": thread_id,
                    "id": "run--" + uuid4().hex,
                    "role": "user",
                    "content": msg["content"],
                },
            )  # 只落库，不 yield

    # 组装输入
    if request.interrupt_feedback:
        # HITL resume：反馈类型决定路由，最新消息保留用户的具体修改要求。
        resume_message = f"[{request.interrupt_feedback}]"
        if request.messages:
            latest_content = request.messages[-1].get("content", "")
            if latest_content:
                resume_message += f" {latest_content}"
        workflow_input = Command(
            resume=resume_message,
            update={"edited_plan": request.plan, "param_list": request.param_list},
        )
    else:
        workflow_input = {
            "messages": request.messages,
            "auto_accepted_plan": request.auto_accepted_plan,
            "param_list": request.param_list,
        }

    workflow_config = {
        "configurable": {
            "thread_id": thread_id,
            "max_plan_iterations": request.max_plan_iterations,
            "max_step_num": request.max_step_num,
            "max_search_results": request.max_search_results,
            # 前端字段 → 后端 Configuration 字段名映射（None 则保留 Configuration 默认值）
            **({"min_quality_score": request.min_step_score} if request.min_step_score is not None else {}),
            **({"max_step_iterations": request.max_step_retry} if request.max_step_retry is not None else {}),
            "mcp_settings": request.mcp_settings or {},

            "resources": request.resources or [],


            "rag_configs": request.rag_configs if request.enable_rag else [],

            "enable_background_investigation": request.enable_background_investigation,
            "enable_web_search": request.enable_web_search,
            "enable_rag": request.enable_rag,
            "auto_select_kb": request.auto_select_kb,
            "retriever_similarity": request.retriever_similarity,
            "retriever_limit": request.retriever_limit,
            "report_style": request.report_style,
        },
        "recursion_limit": get_recursion_limit(),
    }

    async for event in _stream_graph_events(graph, workflow_input, workflow_config, thread_id):
        yield event


# ============ 3. _stream_graph_events（graph.astream 三流模式）============

def _process_tool_call_chunks(tool_call_chunks):
    """Process tool call chunks and sanitize arguments.

    直接对齐主项目 reference-source/deer-flow-aw/src/server/app.py。
    """

    chunks = [ ]

    for chunk in tool_call_chunks:
        chunks.append(
            {
                "name": chunk.get("name", ""),
                "args": sanitize_args(chunk.get("args", "")),
                "id": chunk.get("id", ""),
                "index": chunk.get("index", 0),
                "type": chunk.get("type", ""),
            }
        )
    return chunks


async def _get_current_state(graph_instance, thread_id):
    """Get current graph state for the given thread.

    直接对齐主项目：interrupt 事件需要从 state 读取 step / step_title。
    """
    safe_config = {
        "configurable": {
            "thread_id": thread_id,
            "checkpoint_ns": "",
        }
    }
    return await graph_instance.aget_state(safe_config)


async def _stream_graph_events(graph_instance, workflow_input, workflow_config, thread_id):
    """消费 graph.astream，按事件类型分流处理。

    stream_mode=["messages","updates"]：
      - messages 流产出 (message_chunk, metadata) tuple → _process_message_chunk
      - updates 流产出 dict（含可能的 __interrupt__）→ interrupt 事件
    subgraphs=True：拿到 ReAct 子图内部事件（agent 自主多轮的工具调用）。
    """
    think_parser = ThinkContentParser()
    try:
        async for item in graph_instance.astream(
            workflow_input,
            config=workflow_config,
            stream_mode=["messages", "updates", "custom"],
            subgraphs=True,
        ):
            # 兼容不同 langgraph 版本的产出元组长度（2 或 3）
            if not isinstance(item, (tuple, list)) or len(item) < 2:
                continue
            event_data = item[-1]  # 最后一项是数据
            # 多 stream_mode + subgraphs=True 时首项是子图命名空间，
            # 例如 ("researcher:<task-id>",)。内部 metadata.langgraph_node 通常只是 "agent"，
            # 必须保留命名空间才能让前端识别真正的 researcher。
            agent_path = item[0] if len(item) >= 3 else ()
            current_state = await _get_current_state(graph_instance, thread_id)

            # interrupt（updates 模式的 dict 含 __interrupt__）
            if isinstance(event_data, dict) and "__interrupt__" in event_data:
                yield _create_interrupt_event(thread_id, event_data, current_state)
                continue

            # 对齐原项目：skip 状态生效期间不再向前端转发
            # 当前 ReAct 步骤的后续 chunk，避免点击后继续新增搜索卡。
            if thread_state_manager.get_skip_state(thread_id):
                continue

            # messages 流：event_data = (message_chunk, metadata)
            # 注意：evaluation 事件不在此 updates 分支单独推送——
            # final_report_evaluator_node 已把 evaluation_data 塞进 AIMessage.additional_kwargs，
            # 走 messages 流自然吐出，由 _process_message_chunk 识别 agent_name 后转成 event: evaluation
            if isinstance(event_data, tuple) and len(event_data) == 2:
                message_chunk, metadata = event_data
                if getattr(message_chunk, "content", None):
                    clean_content, think_content = think_parser.process_chunk(
                        message_chunk.content
                    )
                    message_chunk.content = clean_content
                    if think_content is not None:
                        message_chunk.additional_kwargs = {
                            **(getattr(message_chunk, "additional_kwargs", None) or {}),
                            "reasoning_content": think_content,
                        }
                async for evt in _process_message_chunk(
                    message_chunk,
                    metadata,
                    thread_id,
                    current_state,
                    agent_path=agent_path,
                ):
                    yield evt
    except Exception as e:
        logger.exception(f"[stream] graph 执行异常: {e}")
        yield _make_event("error", {"thread_id": thread_id, "error": str(e)})


# ============ 3.5. _create_interrupt_event（HITL interrupt 事件）============

def _create_interrupt_event(thread_id, event_data, state):
    """通过 value 中的 type 字段区分中断类型。

    直接对齐主项目 reference-source/deer-flow-aw/src/server/app.py；
    仅对本章 LangGraph 版本可能返回空 ns 做 ID 兜底。
    """
    interrupt_obj = event_data["__interrupt__"][0]
    interrupt_value = interrupt_obj.value

    node_type = interrupt_value.get("type", "unknown")
    re_execute_times = interrupt_value.get("re_execute_times", -1)

    if node_type == "plan_review":
        options = [
            {"text": "修改计划", "value": "edit_plan"},
            {"text": "开始研究", "value": "accepted"},
        ]
    elif node_type == "retriever_review":
        options = [
            {"text": "Continue", "value": "continue"},
            {"text": "Reselect Resources", "value": "reselect"},
        ]
    elif node_type == "report_review":
        options = [
            {"text": "接受报告", "value": "accepted"},
            {"text": "重新生成", "value": "continue"},
        ]
    else:
        options = [{"text": "Continue", "value": "continue"}]


    interrupt_ns = getattr(interrupt_obj, "ns", None) or [ ]

    event_data_dict = {
        "thread_id": thread_id,
        "role": "assistant",
        "content": interrupt_value["message"],
        "node_type": node_type,
        "finish_reason": "interrupt",
        "options": options,
        "id": interrupt_ns[0] if interrupt_ns else "intr--" + uuid4().hex,
        "step": state.values.get("step", ""),
        "step_title": state.values.get("step_title", ""),
        "additional_info": {
            "re_execute_times": re_execute_times,
            **(
                {"retrieval_review": interrupt_value.get("review_data")}
                if interrupt_value.get("review_data") is not None
                else {}
            ),
        },
    }

    return _make_event("interrupt", event_data_dict)


# ============ 4. _process_message_chunk（chunk → SSE 事件）============

def _get_agent_name(agent_path, metadata) -> str:
    """优先从子图命名空间还原业务节点名，回退到消息 metadata。"""
    if agent_path and len(agent_path) > 0:
        first = str(agent_path[0])
        return first.split(":", 1)[0]
    return (metadata or {}).get("langgraph_node", "")


async def _process_message_chunk(
    message_chunk, metadata, thread_id, state, agent_path=()
):
    """把单个消息 chunk 转成前端可消费的 SSE 事件。"""
    # 跳过用户输入回显（已在前面处理）
    if isinstance(message_chunk, HumanMessage):
        return

    meta = metadata or {}
    agent_name = _get_agent_name(agent_path, meta)
    msg_id = getattr(message_chunk, "id", None) or "run--" + uuid4().hex
    state_values = getattr(state, "values", {}) or {}
    current_plan = state_values.get("current_plan")
    step_iterations = 0
    if agent_name in ("researcher", "coder", "eval"):
        step_str = state_values.get("step", "")
        try:
            step_index = int(str(step_str).removeprefix("step"))

            steps = current_plan.steps if hasattr(current_plan, "steps") else [ ]

            step_iterations = steps[step_index].step_iterations
        except (AttributeError, IndexError, TypeError, ValueError):
            step_iterations = 0

    base = {
        "thread_id": thread_id,
        "id": msg_id,
        "agent": agent_name,
        "role": "assistant",
        "step": state_values.get("step", ""),
        "step_title": state_values.get("step_title", ""),
        "additional_info": (
            {"re_execute_times": step_iterations}
            if agent_name in ("researcher", "coder", "eval")
            else {}
        ),
    }

    # evaluation 事件（直接对齐主项目做法）：
    # eval / final_report_evaluator 内部 structured-output token 不属于聊天正文，
    # 只有节点显式写入 evaluation_data 的 AIMessage 才转成 event: evaluation。
    additional_kwargs = getattr(message_chunk, "additional_kwargs", None) or {}
    reasoning_content = additional_kwargs.get("reasoning_content")
    if reasoning_content:
        base["reasoning_content"] = reasoning_content

    activity = additional_kwargs.get("activity")
    if activity:
        base["additional_info"]["activity"] = activity
    elif agent_name == "researcher":
        base["additional_info"]["activity"] = {
            "activity_type": ActivityType.EXECUTE_RESEARCH.type,
            "activity_name": ActivityType.EXECUTE_RESEARCH.description,
        }
    elif agent_name == "eval":
        base["additional_info"]["activity"] = {
            "activity_type": ActivityType.EVALUATE_RESEARCH.type,
            "activity_name": ActivityType.EVALUATE_RESEARCH.description,
        }

    if agent_name in ("eval", "final_report_evaluator"):
        if additional_kwargs.get("evaluation_data"):
            base["content"] = message_chunk.content or ""
            base["evaluation_data"] = additional_kwargs["evaluation_data"]
            re_execute_times = additional_kwargs.get("re_execute_times")
            if re_execute_times is not None:
                base["additional_info"]["re_execute_times"] = re_execute_times
            finish_reason = getattr(message_chunk, "response_metadata", {}).get("finish_reason")
            if finish_reason and finish_reason != "none":
                base["finish_reason"] = finish_reason
            yield _make_event("evaluation", base)
        elif activity:
            base["content"] = message_chunk.content or ""
            yield _make_event("message_chunk", base)
        return

    if isinstance(message_chunk, ToolMessage):
        # 工具返回结果
        base["tool_call_id"] = message_chunk.tool_call_id
        base["content"] = message_chunk.content
        yield _make_event("tool_call_result", base)
    elif isinstance(message_chunk, AIMessageChunk):
        # AI Message - Raw message tokens
        if message_chunk.tool_calls:
            # AI Message - Tool Call
            base["tool_calls"] = message_chunk.tool_calls
            base["tool_call_chunks"] = _process_tool_call_chunks(
                message_chunk.tool_call_chunks
            )
            base["content"] = message_chunk.content or ""
            yield _make_event("tool_calls", base)
        elif message_chunk.tool_call_chunks:
            # AI Message - Tool Call Chunks
            base["tool_call_chunks"] = _process_tool_call_chunks(
                message_chunk.tool_call_chunks
            )

            # 对齐主项目：带工具名的首段同时作为 tool_calls，后续无名片段走 tool_call_chunks。
            has_tool_call_chunk_name = any(
                chunk.get("name", "") for chunk in message_chunk.tool_call_chunks
            )
            event_type = (
                "tool_calls" if has_tool_call_chunk_name else "tool_call_chunks"
            )
            if has_tool_call_chunk_name:
                base["tool_calls"] = message_chunk.tool_call_chunks
            yield _make_event(event_type, base)
        else:
            # AI Message - Raw message tokens
            base["content"] = message_chunk.content or ""
            finish_reason = meta.get("finish_reason") or getattr(message_chunk, "response_metadata", {}).get("finish_reason")
            if finish_reason and finish_reason != "none":
                base["finish_reason"] = finish_reason
            yield _make_event("message_chunk", base)


# ============ 5. _make_event（SSE 帧 + 落库）============

def _make_event(event_type: str, data: dict) -> str:
    """构造 SSE 帧（event: X\ndata: {json}\n\n）并落库业务表。"""
    thread_id = data.get("thread_id", "")
    if data.get("content") == "":
        data.pop("content", None)
    try:
        json_data = json.dumps(data, ensure_ascii=False)
    except (TypeError, ValueError) as e:
        logger.error(f"[sse] 序列化失败: {e}")
        json_data = json.dumps({"error": "Serialization failed"}, ensure_ascii=False)

    finish_reason = data.get("finish_reason", "none")
    # 落库：每个 SSE 帧存一行（刷新/重启后可回看）
    db = SessionLocal()
    try:
        repository.append_chat_stream(db, thread_id, event_type, json_data, finish_reason)
    except Exception as e:
        logger.warning(f"[sse] 落库失败（不影响流式）: {e}")
    finally:
        db.close()

    return f"event: {event_type}\ndata: {json_data}\n\n"


# ============ 会话生命周期 API（list / get / delete）============

@app.get("/api/conversations")
def list_conversations(db: Session = Depends(get_db)):
    """列出所有会话（thread_id 去重 + 最后更新时间）。"""
    return {"data": repository.list_conversations(db)}


@app.get("/api/conversation/{thread_id}")
def get_conversation(thread_id: str, db: Session = Depends(get_db)):
    """获取某会话的全部事件（前端回放用）。"""
    rows = repository.get_conversation(db, thread_id)
    replay = "".join(f"event: {row['event_type']}\ndata: {row['content']}\n\n" for row in rows)
    return PlainTextResponse(replay, media_type="text/plain")


@app.delete("/api/conversation/{thread_id}")
async def delete_conversation(thread_id: str, db: Session = Depends(get_db)):
    """删除会话的回放事件与 LangGraph checkpoint。"""
    try:
        await graph.checkpointer.adelete_thread(thread_id)
        repository.delete_conversation(db, thread_id)
        return {
            "thread_id": thread_id,
            "deleted": True,
            "message": "Conversation deleted successfully",
        }
    except Exception as e:
        logger.exception(f"[conversation] 删除失败: {e}")
        return {
            "thread_id": thread_id,
            "deleted": False,
            "message": f"Error deleting conversation: {e}",
        }


# ============ 第9章：前后端协作（skip 控制 + 业务可观测）============

@app.post("/api/chat/skip")
def skip_chat(request: SkipRequest):
    """跳过当前研究步骤：设置 skip 状态，graph 继续跑（不停）。

    _execute_agent_step 执行前检查 skip，跳过当前 step 但 graph 推进到下一步。
    区别于 cancel：skip 保留状态完整更新（步骤断点续），graph 跑完整个流程。
    """
    thread_state_manager.set_skip_state(request.thread_id, should_skip=True)
    return {"thread_id": request.thread_id, "skip_set": True, "message": "已请求跳过当前步骤"}


@app.get("/api/conversation/{thread_id}/events")
def get_graph_events_api(thread_id: str, db: Session = Depends(get_db)):
    """节点事件流水（业务可观测：无 LangSmith 也能复盘节点轨迹，合规行业必备）。"""
    return repository.get_graph_events(db, thread_id)


# ============ 前端对接 stub 端点 ============
# 前端骨架启动时会调这些端点。本章后端只做当前主题相关的实现，
# 用 stub 让前端不崩即可。后续章节陆续实现真实逻辑。

@app.get("/api/config")
def get_config_stub():

    return {"rag": {"provider": "memory"}, "models": {"basic": ["Qwen3-32B-FP8"], "reasoning": []}}



@app.get("/api/templates")
def list_templates_stub():

    return [ ]



@app.get("/api/config/rag/get_config")
def get_rag_config(db: Session = Depends(get_db)):
    # 契约对齐主项目 reference-source/deer-flow-aw/src/server/api/rag.py:99：
    # 直接返回 list[dict]（前端 knowledge-tab.tsx 用 configs.map 消费）。
    return rag_config_service.list_configs(db)


@app.post("/api/config/rag/save_config")
def save_rag_config(payload: RAGConfigPayload, db: Session = Depends(get_db)):
    # 契约对齐主项目 rag.py:83-92：直接返回配置对象（前端读 result.id）。
    return rag_config_service.create(db, payload)


@app.put("/api/config/rag/{config_id}")
def update_rag_config(config_id: str, payload: dict, db: Session = Depends(get_db)):
    updated = rag_config_service.update(db, config_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="知识库配置不存在")
    return updated


@app.delete("/api/config/rag/{config_id}")
def delete_rag_config(config_id: str, db: Session = Depends(get_db)):
    return {"deleted": rag_config_service.delete(db, config_id), "id": config_id}


@app.post("/api/config/rag/test_connection")
def test_rag_connection(payload: RAGConnectionPayload):
    # aihub 平台走真实连接（登录 + 拉资源列表），暴露账号密码/网络等真实错误。
    # 其它平台保留结构校验的 stub 行为（教程不实现真连接，诚实标注）。
    if payload.platform == "aihub":
        from rag.aihub import AIHubProvider

        provider = AIHubProvider(
            api_url=payload.api_url,
            username=payload.ext_config.get("username", ""),
            password=payload.ext_config.get("password", ""),
        )
        return provider.test_connection()

    # 非 aihub：仅结构校验，不代表真连成功

    resources = payload.ext_config.get("resources", [])

    return {
        "success": True,
        "resource_count": len(resources),
        "message": f"{payload.platform} 配置校验通过（stub，仅结构校验）",
    }


@app.get("/api/rag/resources")
def query_rag_resources(query: str = "", db: Session = Depends(get_db)):
    return {"resources": rag_config_service.query_resources(db, query)}


@app.post("/api/mcp/server/metadata")
async def mcp_server_metadata(payload: dict):
    if not is_mcp_enabled():
        raise HTTPException(status_code=403, detail="MCP 未启用，设 ENABLE_MCP_SERVER_CONFIGURATION=true")
    # 白名单过滤：langchain-mcp-adapters 的 _create_stdio_session 只接受
    # transport/command/args/url/env/headers 等启动参数，收到 `name` 之类的额外键会 TypeError。
    # 保持与 nodes.py:481-483 主加载路径同款过滤，避免预览路径独有的字段污染。
    connection = {
        k: v for k, v in payload.items()
        if k in ("transport", "command", "args", "url", "env", "headers") and v is not None
    }
    tools = await load_mcp_tools({"preview": connection}, timeout_seconds=15)
    # 契约对齐主项目 reference-source/deer-flow-aw/src/server/app.py:980-988：
    # 回传前端 POST 上来的启动字段（transport/command/args/url/env/headers），
    # 前端 add-mcp-server-dialog.tsx:116 `{...metadata, name, enabled}` 靠这些字段
    # 把完整 server 描述存进 store —— 缺一个都会让 getChatStreamSettings 序列化时

    # 丢字段，导致 /api/chat/stream 收到只剩 {name, enabled_tools:[], add_to_agents} 的残缺配置。

    return {
        "transport": payload.get("transport"),
        "command": payload.get("command"),
        "args": payload.get("args"),
        "url": payload.get("url"),
        "env": payload.get("env"),
        "headers": payload.get("headers"),
        "tools": [
            {
                "name": getattr(tool, "name", type(tool).__name__),
                "description": getattr(tool, "description", ""),
            }
            for tool in tools
        ],

        "prompts": [],


        "resources": [],

    }

```

### 5.6 H：前端研究交互完整文件

> 以下目标路径位于共享前端 `tutorial/web`，不是 chapter10/code。复制后必须重新启动前端开发服务器。

#### tutorial/web/src/core/api/chat.ts

修改内容：完整覆盖：聊天请求字段、interrupt 和 SSE 解析。

```typescript
// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { env } from "~/env";

import type { MCPServerMetadata } from "../mcp";
import type { Resource } from "../messages";
import { extractFromSearchParams } from "../replay/get-replay-id";
import { fetchStream } from "../sse";
import { sleep } from "../utils";

import { queryConversationByPath } from "./conversations";
import { resolveServiceURL } from "./resolve-service-url";
import type { ChatEvent } from "./types";

type Param = {
  name: string;
  value: any;
};

export async function* chatStream(
  userMessage: string,
  params: {
    thread_id: string;
    resources?: Array<Resource>;
    auto_accepted_plan: boolean;
    max_plan_iterations: number;
    max_step_num: number;
    max_search_results?: number;
    retriever_similarity?: number | undefined;
    retriever_limit?: number | undefined;
    interrupt_feedback?: string;
    enable_deep_thinking?: boolean;
    enable_background_investigation: boolean;
    enable_web_search?: boolean;
    enable_rag?: boolean;
    auto_select_kb?: boolean;
    report_style?: "academic" | "popular_science" | "news" | "social_media";
    mcp_settings?: {
      servers: Record<
        string,
        MCPServerMetadata & {

          enabled_tools: string[];


          add_to_agents: string[];

        }
      >;
    };
    rag_configs?: Array<{
      rag_platform_id: string;
      platform: string;
      api_url: string;
      retrieval_size: number;
      similarity: number;
      ext_config: Record<string, any>;
    }>;
    param_list?: Array<any>;
    plan?: any;
    max_step_retry?: number;
    min_step_score?: number;
  },
  options: { abortSignal?: AbortSignal } = {},
) {
  if (
    env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY ||
    location.search.includes("mock") ||
    location.search.includes("replay=") ||
    location.search.includes("thread_id=")
  )
    return yield* chatReplayStream(userMessage, params, options);

  try {
    const stream = fetchStream(resolveServiceURL("chat/stream"), {
      body: JSON.stringify({
        messages: [{ role: "user", content: userMessage }],
        ...params,
      }),
      signal: options.abortSignal,
    });
    for await (const event of stream) {
      yield {
        type: event.event,
        data: JSON.parse(event.data),
      } as ChatEvent;
    }
  } catch (e) {
    console.error(e);
  }
}

async function* chatReplayStream(
  userMessage: string,
  params: {
    thread_id?: string;
    auto_accepted_plan?: boolean;
    max_plan_iterations?: number;
    max_step_num?: number;
    max_search_results?: number;
    retriever_similarity?: number;
    retriever_limit?: number;
    interrupt_feedback?: string;
    param_list?: Array<any>;
  } = {
      thread_id: "__mock__",
      auto_accepted_plan: false,
      max_plan_iterations: 3,
      max_step_num: 1,
      max_search_results: 3,
      retriever_similarity: 0.4,
      retriever_limit: 0,
      interrupt_feedback: undefined,

      param_list: [],

    },
  options: { abortSignal?: AbortSignal } = {},
): AsyncIterable<ChatEvent> {
  const urlParams = new URLSearchParams(window.location.search);
  let replayFilePath = "";
  if (urlParams.has("mock")) {
    if (urlParams.get("mock")) {
      replayFilePath = `/mock/${urlParams.get("mock")!}.txt`;
    } else {
      if (params.interrupt_feedback === "accepted") {
        replayFilePath = "/mock/final-answer.txt";
      } else if (params.interrupt_feedback === "edit_plan") {
        replayFilePath = "/mock/re-plan.txt";
      } else {
        replayFilePath = "/mock/first-plan.txt";
      }
    }
  } else if (urlParams.has("thread_id")) {
    const threadId = extractFromSearchParams(
      window.location.search,
      "thread_id",
    );
    if (threadId) {
      replayFilePath = `/api/conversation/${threadId}`;
    } else {
      // Fallback to a default replay
      replayFilePath = `/replay/eiffel-tower-vs-tallest-building.txt`;
    }
  } else {
    const replayId = extractFromSearchParams(window.location.search, "replay");
    if (replayId) {
      replayFilePath = `/replay/${replayId}.txt`;
    } else {
      // Fallback to a default replay
      replayFilePath = `/replay/eiffel-tower-vs-tallest-building.txt`;
    }
  }
  const text = replayFilePath.startsWith("/api/conversation") ? await queryConversationByPath(replayFilePath, {
    abortSignal: options.abortSignal,
  }) : await fetchReplay(replayFilePath, {
    abortSignal: options.abortSignal,
  });
  const normalizedText = text.replace(/\r\n/g, "\n");
  const chunks = normalizedText.split("\n\n");

  for (const chunk of chunks) {
    const [eventRaw, dataRaw] = chunk.split("\n") as [string, string];
    const [, event] = eventRaw.split("event: ", 2) as [string, string];
    if (!dataRaw) {
      continue; // 跳过无效数据
    }
    const [, data] = dataRaw.split("data: ", 2) as [string, string];

    try {
      const chatEvent = {
        type: event,
        data: JSON.parse(data),
      } as ChatEvent;
      // 简化的内容分析器 - 专注于流式效果优化
      const analyzeContentForTypewriter = (content: string, contentType: string) => {
        if (!content) return {};

        // 基础分析 - 仅保留对流式效果有用的信息
        const lastChar = content.slice(-1);
        const isPunctuation = /[.!?;:,，。！？；：]/.test(lastChar);
        const isWordEnd = /\s+$/.test(content) || isPunctuation;
        const chunkLength = content.length;

        return {
          chunkLength,
          isPunctuation,
          isWordEnd,
        };
      };

      if (chatEvent.type === "message_chunk") {
        if (!chatEvent.data.finish_reason) {
          const content = chatEvent.data.content || '';
          const context = analyzeContentForTypewriter(content, 'message_chunk');
          // 仅在非最高速时使用打字机效果
          if (fastForwardSpeed < 5) {
            await sleepInReplay(50, 'message_chunk', context);
          }
        }
      } else if (chatEvent.type === "tool_call_result") {
        const content = JSON.stringify(chatEvent.data || {});
        const context = analyzeContentForTypewriter(content, 'tool_call_result');
        // 仅在非最高速时使用打字机效果
        if (fastForwardSpeed < 5) {
          await sleepInReplay(500, 'tool_call_result', context);
        }
      }
      yield chatEvent;
      if (chatEvent.type === "tool_call_result") {
        const content = JSON.stringify(chatEvent.data || {});
        const context = analyzeContentForTypewriter(content, 'tool_call_result');
        // 仅在非最高速时使用打字机效果
        if (fastForwardSpeed < 5) {
          await sleepInReplay(800, 'tool_call_result', context);
        }
      } else if (chatEvent.type === "message_chunk") {
        if (chatEvent.data.role === "user") {
          const content = chatEvent.data.content || '';
          const context = analyzeContentForTypewriter(content, 'user_message');
          // 仅在非最高速时使用打字机效果
          if (fastForwardSpeed < 5) {
            await sleepInReplay(500, 'user_message', context);
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  }
}

const replayCache = new Map<string, string>();
export async function fetchReplay(
  url: string,
  options: { abortSignal?: AbortSignal } = {},
) {
  if (replayCache.has(url)) {
    return replayCache.get(url)!;
  }
  const res = await fetch(url, {
    signal: options.abortSignal,
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch replay: ${res.statusText}`);
  }
  const text = await res.text();
  replayCache.set(url, text);
  return text;
}

export async function fetchReplayTitle() {
  const res = chatReplayStream(
    "",
    {
      thread_id: "__mock__",
      auto_accepted_plan: false,
      max_plan_iterations: 3,
      max_step_num: 1,
      max_search_results: 3,
    },
    {},
  );
  for await (const event of res) {
    if (event.type === "message_chunk") {
      return event.data.content;
    }
  }
}

// 快进速度状态：0 = 正常速度, 1 = 2倍速, 2 = 4倍速, 3 = 6倍速, 4 = 8倍速, 5 = 直接输出无延时
let fastForwardSpeed = 0;

let sleepWorker: Worker | null = null;
let sleepPromises = new Map<string, { resolve: () => void; reject: (error: Error) => void; timeout?: NodeJS.Timeout }>();
let messageIdCounter = 0;
let isWorkerInitializing = false;

// 清理过期的Promise，防止内存泄漏
function cleanupExpiredPromises() {
  const now = Date.now();
  sleepPromises.forEach((promise, id) => {
    // 清理超过10秒的Promise
    if (promise.timeout && now - (promise.timeout as any) > 10000) {
      promise.resolve(); // 直接resolve避免卡死
      sleepPromises.delete(id);
    }
  });
}

// 统一的Worker初始化函数
async function initializeSleepWorker(): Promise<Worker> {
  if (sleepWorker && !isWorkerInitializing) {
    return sleepWorker;
  }

  if (isWorkerInitializing) {
    // 等待初始化完成
    return new Promise((resolve) => {
      const checkWorker = () => {
        if (sleepWorker && !isWorkerInitializing) {
          resolve(sleepWorker);
        } else {
          setTimeout(checkWorker, 10);
        }
      };
      checkWorker();
    });
  }

  isWorkerInitializing = true;

  try {
    sleepWorker = new Worker(new URL('../workers/sleep-worker.ts', import.meta.url), {
      type: 'module',
    });

    sleepWorker.addEventListener('message', (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'sleepComplete') {
        const { id } = message;
        const promise = sleepPromises.get(id);
        if (promise) {
          promise.resolve();
          sleepPromises.delete(id);
        }
      }
    });

    sleepWorker.addEventListener('error', (error) => {
      console.error('Sleep Worker error:', error);
      // 拒绝所有 pending 的 promise
      sleepPromises.forEach((promise) => {
        promise.reject(new Error('Sleep Worker error'));
      });
      sleepPromises.clear();
      sleepWorker = null;
      isWorkerInitializing = false;
    });

    // 发送当前速度设置
    sleepWorker.postMessage({ type: 'setSpeed', speed: fastForwardSpeed });
    return sleepWorker;
  } catch (error) {
    console.error('Failed to initialize worker:', error);
    isWorkerInitializing = false;
    throw error;
  } finally {
    isWorkerInitializing = false;
  }
}

// 获取Worker实例
function getSleepWorker(): Worker {
  if (!sleepWorker) {
    throw new Error('Worker not initialized. Call initializeSleepWorker() first.');
  }
  return sleepWorker;
}

export async function fastForwardReplay(value: number) {
  // 防抖处理，避免频繁调用
  if (fastForwardSpeed === value) {
    return;
  }

  fastForwardSpeed = value;

  try {
    const worker = await initializeSleepWorker();
    worker.postMessage({ type: 'setSpeed', speed: fastForwardSpeed });
  } catch (error) {
    console.error('Failed to update speed:', error);
  }
}

export async function sleepInReplay(
  ms: number,
  contentType?: 'message_chunk' | 'tool_call_result' | 'user_message',
  context?: {
    chunkLength?: number;
    isPunctuation?: boolean;
    isWordEnd?: boolean;
  }
) {
  // 快速路径：速度为5时直接返回，不创建Promise
  if (fastForwardSpeed === 5) {
    return Promise.resolve();
  }

  // 定期清理过期Promise
  if (messageIdCounter % 100 === 0) {
    cleanupExpiredPromises();
  }

  const id = `sleep-${++messageIdCounter}`;

  return new Promise<void>((resolve, reject) => {
    // 设置超时保护
    const timeoutId = setTimeout(() => {
      console.warn(`Sleep timeout for id: ${id}, resolving to prevent deadlock`);
      resolve();
      sleepPromises.delete(id);
    }, 5000); // 5秒超时

    // 存储 promise 的 resolve 和 reject
    sleepPromises.set(id, {
      resolve: () => {
        clearTimeout(timeoutId);
        resolve();
      },
      reject: (error: Error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
      timeout: timeoutId as any
    });

    // 发送消息给 worker
    initializeSleepWorker().then(worker => {
      worker.postMessage({
        type: 'sleep',
        id,
        ms,
        fastForwardSpeed,
        contentType,
        ...context,
      });
    }).catch(error => {
      clearTimeout(timeoutId);
      reject(error);
      sleepPromises.delete(id);
    });
  });
}

```

#### tutorial/web/src/core/messages/types.ts

修改内容：完整覆盖：step、评估、检索审核和活动消息类型。

```typescript
// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

export type MessageRole = "user" | "assistant" | "tool";

interface activityInterface{
  activity_type?:string
  activity_name?:string
}
interface additional_infoInterface {
  activity?:activityInterface
  re_execute_times?: number;
  retrieval_review?: {
    query?: string;
    similarity?: number;
    documents?: Array<{
      id?: string;
      title?: string;
      resource_title?: string;
      chunks?: Array<{ content?: string; similarity?: number }>;
    }>;
  };
}
export interface Message {
  id: string;
  threadId: string;
  agent?:
  | "coordinator"
  | "planner"
  | "researcher"
  | "coder"
  | "reporter"
  | "podcast"
  | "eval"
  | "final_report_evaluator"
  | "recognize_knowy";
  role: MessageRole;
  isStreaming?: boolean;
  content: string;

  contentChunks: string[];

  reasoningContent?: string;

  reasoningContentChunks?: string[];


  toolCalls?: ToolCallRuntime[];


  options?: Option[];

  finishReason?: "stop" | "interrupt" | "tool_calls";
  interruptFeedback?: string;
  resources?: Array<Resource>;
  evaluation?: EvaluationResult;
  nodeType?:string,
  step?:string,
  step_title?:string,
  additional_info?:additional_infoInterface, // ("recognize_knowy", "识别知识库")("execute_research", "执行研究")("evaluate_research", "评估研究结果")
  checkpoint_id?:string,
  evaluation_data?:string,
}

export interface EvaluationResult {
  result?: string;
  stepId?: string;
  stepTitle?: string;
  stepType?: string;
  qualityScore?: number;
  feedback?: string;
  evaluationTimestamp?: string;
  evaluatorName?: string;
  evaluationStatus?: string;
}

export interface Option {
  text: string;
  value: string;
}

export interface ToolCallRuntime {
  id: string;
  name: string;
  args: Record<string, unknown>;

  argsChunks?: string[];

  result?: string;
  contentTxt?:unknown,
  retriever_keyword?:string,
  step?:string,
}

export interface Resource {
  uri: string;
  title: string;
  rag_platform_id: string;
}

export interface Param {
  name: string;
  value: string;
}
export interface Conversation {
  id: string;
  title: string;
  count: number;
  date: string;
  category: string;
  data_type: string;
}

```

#### tutorial/web/src/core/store/store.ts

修改内容：完整覆盖：SSE 入 Store、silent resume 和审核状态。

```typescript
/* eslint-disable import/order */
// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { nanoid } from "nanoid";
import { toast } from "sonner";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { chatStream, generatePodcast } from "../api";
import type { Message, Resource, Param } from "../messages";
import { mergeMessage } from "../messages";
import { parseJSON } from "../utils";

import { getChatStreamSettings } from "./settings-store";

import { getReportStyleTitleById } from "~/lib/utils";
const THREAD_ID = nanoid();
export const useStore = create<{
  responding: boolean;
  threadId: string | undefined;

  messageIds: string[];

  messages: Map<string, Message>;

  researchIds: string[];

  researchPlanIds: Map<string, string>;
  researchReportIds: Map<string, string>;

  researchActivityIds: Map<string, string[]>;

  ongoingResearchId: string | null;
  openResearchId: string | null;

  appendMessage: (message: Message) => void;
  updateMessage: (message: Message) => void;

  updateMessages: (messages: Message[]) => void;

  openResearch: (researchId: string | null) => void;
  closeResearch: () => void;
  setOngoingResearch: (researchId: string | null) => void;
}>((set) => ({
  responding: false,
  threadId: THREAD_ID,

  messageIds: [],

  messages: new Map<string, Message>(),

  researchIds: [],

  researchPlanIds: new Map<string, string>(),
  researchReportIds: new Map<string, string>(),

  researchActivityIds: new Map<string, string[]>(),

  ongoingResearchId: null,
  openResearchId: null,

  appendMessage(message: Message) {
    set((state) => ({
      messageIds: [...state.messageIds, message.id],
      messages: new Map(state.messages).set(message.id, message),
    }));
  },
  updateMessage(message: Message) {
    set((state) => ({
      messages: new Map(state.messages).set(message.id, message),
    }));
  },

  updateMessages(messages: Message[]) {

    set((state) => {
      const newMessages = new Map(state.messages);
      messages.forEach((m) => newMessages.set(m.id, m));
      return { messages: newMessages };
    });
  },
  openResearch(researchId: string | null) {
    set({ openResearchId: researchId });
  },
  closeResearch() {
    set({ openResearchId: null });
  },
  setOngoingResearch(researchId: string | null) {
    set({ ongoingResearchId: researchId });
  },
}));

export async function sendMessage(
  content?: string,
  {
    interruptFeedback,
    resources,
    param_list,
    plan,
    silent = false,
  }: {
    interruptFeedback?: string;
    resources?: Array<Resource>;
    param_list?: Array<Param>;
    plan?: any;
    silent?: boolean;
  } = {},
  options: { abortSignal?: AbortSignal } = {},
) {
  if (content != null && !silent) {
    appendMessage({
      id: nanoid(),
      threadId: THREAD_ID,
      role: "user",
      content: content,
      contentChunks: [content],
      resources,
    });
  }
  const settings = getChatStreamSettings();
  const stream = chatStream(
    content ?? "[REPLAY]",
    {
      thread_id: THREAD_ID,
      interrupt_feedback: interruptFeedback,
      resources,
      auto_accepted_plan: settings.autoAcceptedPlan,
      enable_deep_thinking: settings.enableDeepThinking ?? false,
      enable_background_investigation:
        settings.enableBackgroundInvestigation ?? true,
      enable_web_search: settings.enableWebSearch ?? false,
      enable_rag: settings.enableRAG ?? true,
      max_plan_iterations: settings.maxPlanIterations,
      max_step_num: settings.maxStepNum,
      max_search_results: settings.maxSearchResults,
      retriever_similarity: settings.retriever_similarity,
      retriever_limit: settings.retriever_limit,
      report_style: getReportStyleTitleById(settings.reportStyle),
      mcp_settings: settings.mcpSettings,
      rag_configs: settings.rag_configs,
      param_list: param_list,
      plan: plan,
      max_step_retry: settings.max_step_retry,
      min_step_score: settings.min_step_score,
      auto_select_kb: settings.autoSelectKB,
    },
    options,
  );

  setResponding(true);
  let messageId: any;
  const pendingUpdates = new Map<string, Message>();
  let updateTimer: NodeJS.Timeout | undefined;

  const scheduleUpdate = () => {
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      // Batch update message status
      if (pendingUpdates.size > 0) {
        useStore.getState().updateMessages(Array.from(pendingUpdates.values()));
        pendingUpdates.clear();
      }
    }, 16); // ~60fps
  };

  try {
    for await (const event of stream) {
      const { type, data } = event as any;
      messageId = data.id;
      let message: Message | undefined;
      if (
        type === "interrupt" &&
        (
          data.node_type == "retriever_review" ||
          data.node_type == "llm_output_review" ||
          data.node_type == "report_review"
        )
      ) {
        if (!existsMessage(messageId)) {
          // 强制创建消息，即使agent不存在
          message = {
            id: messageId,
            threadId: data.thread_id,
            agent: data.agent || "interrupt_agent", // 给一个默认agent，避免undefined
            role: data.role,
            content: data.content || "", // 直接从data取content
            contentChunks: [data.content || ""],
            isStreaming: false,
            finishReason: data.finish_reason, // 关键：设置finishReason
            options: data.options, // 保存interrupt的选项
          };
          if (data?.step) {
            message.step = data.step;
            message.step_title = data.step_title;
          }
          // 当前活动提示
          if (data?.additional_info) {
            message.additional_info = data.additional_info;
          }
          if (data?.node_type) {
            message.nodeType = data.node_type;
          }
          appendMessage(message); // 加入全局消息列表
        }
      }
      else if (type === "tool_call_result") {
        message = findMessageByToolCallId(data.tool_call_id);
      } else if (!existsMessage(messageId)) {
        message = {
          id: messageId,
          threadId: data.thread_id,
          agent: data.agent,
          role: data.role,
          content: "",

          contentChunks: [],

          reasoningContent: "",

          reasoningContentChunks: [],

          isStreaming: true,
          interruptFeedback,
        };
        if (data?.step) {
          message.step = data.step;
          message.step_title = data.step_title;
        }
        if (data.agent === "final_report_evaluator" && data?.evaluation_data) {
          message.isStreaming = false;
          message.checkpoint_id = data.checkpoint_id;
        }
        // 当前活动提示
        if (data?.additional_info) {
          message.additional_info = data.additional_info;
        }
        appendMessage(message); // 加入全局消息列表
      }
      message ??= getMessage(messageId);
      if (message) {
        message = mergeMessage(message, event);
        if (message.agent === "final_report_evaluator" && message?.evaluation_data && message.isStreaming) {
          message.isStreaming = false;
          message.checkpoint_id = data.checkpoint_id;
        }
        // Collect pending messages for update, instead of updating immediately.
        pendingUpdates.set(message.id, message);
        scheduleUpdate();
      }
    }
  } catch {
    toast("An error occurred while generating the response. Please try again.");
    // Update message status.
    // TODO: const isAborted = (error as Error).name === "AbortError";
    if (messageId != null) {
      const message = getMessage(messageId);
      if (message?.isStreaming) {
        message.isStreaming = false;
        useStore.getState().updateMessage(message);
      }
    }
    useStore.getState().setOngoingResearch(null);
  } finally {
    setResponding(false);
    // Ensure all pending updates are processed.
    if (updateTimer) clearTimeout(updateTimer);
    if (pendingUpdates.size > 0) {
      useStore.getState().updateMessages(Array.from(pendingUpdates.values()));
    }
  }
}

function setResponding(value: boolean) {
  useStore.setState({ responding: value });
}

function existsMessage(id: string) {
  return useStore.getState().messageIds.includes(id);
}

function getMessage(id: string) {
  return useStore.getState().messages.get(id);
}

function findMessageByToolCallId(toolCallId: string) {
  return Array.from(useStore.getState().messages.values())
    .reverse()
    .find((message) => {
      if (message.toolCalls) {
        return message.toolCalls.some((toolCall) => toolCall.id === toolCallId);
      }
      return false;
    });
}

function appendMessage(message: Message) {
  if (
    message.agent === "coder" ||
    message.agent === "reporter" ||
    message.agent === "researcher" ||
    message.agent === "eval" || message.agent === "final_report_evaluator" || message.agent === "recognize_knowy" ||
    message.finishReason === "interrupt"
  ) {
    if (!getOngoingResearchId() && message.agent !== "final_report_evaluator") {
      const id = message.id;
      appendResearch(id);
      openResearch(id);
    }
    appendResearchActivity(message);
  }
  useStore.getState().appendMessage(message);
}

function updateMessage(message: Message) {
  if (
    getOngoingResearchId() &&
    message.agent === "reporter" &&
    !message.isStreaming
  ) {
    useStore.getState().setOngoingResearch(null);
  }
  useStore.getState().updateMessage(message);
}

function getOngoingResearchId() {
  return useStore.getState().ongoingResearchId;
}

function appendResearch(researchId: string) {
  let planMessage: Message | undefined;
  const reversedMessageIds = [...useStore.getState().messageIds].reverse();
  for (const messageId of reversedMessageIds) {
    const message = getMessage(messageId);
    if (message?.agent === "planner") {
      planMessage = message;
      break;
    }
  }
  const messageIds = [researchId];
  messageIds.unshift(planMessage!.id);
  useStore.setState({
    ongoingResearchId: researchId,
    researchIds: [...useStore.getState().researchIds, researchId],
    researchPlanIds: new Map(useStore.getState().researchPlanIds).set(
      researchId,
      planMessage!.id,
    ),
    researchActivityIds: new Map(useStore.getState().researchActivityIds).set(
      researchId,
      messageIds,
    ),
  });
}

function appendResearchActivity(message: Message) {
  const researchId = getOngoingResearchId();
  if (researchId) {
    const researchActivityIds = useStore.getState().researchActivityIds;
    const current = researchActivityIds.get(researchId)!;
    if (!current.includes(message.id)) {
      useStore.setState({
        researchActivityIds: new Map(researchActivityIds).set(researchId, [
          ...current,
          message.id,
        ]),
      });
    }
    if (message.agent === "reporter") {
      useStore.setState({
        researchReportIds: new Map(useStore.getState().researchReportIds).set(
          researchId,
          message.id,
        ),
      });
    }
  }
}

export function openResearch(researchId: string | null) {
  useStore.getState().openResearch(researchId);
}

export function closeResearch() {
  useStore.getState().closeResearch();
}

export async function listenToPodcast(researchId: string) {
  const planMessageId = useStore.getState().researchPlanIds.get(researchId);
  const reportMessageId = useStore.getState().researchReportIds.get(researchId);
  if (planMessageId && reportMessageId) {
    const planMessage = getMessage(planMessageId)!;
    const title = parseJSON(planMessage.content, { title: "Untitled" }).title;
    const reportMessage = getMessage(reportMessageId);
    if (reportMessage?.content) {
      appendMessage({
        id: nanoid(),
        threadId: THREAD_ID,
        role: "user",
        content: "Please generate a podcast for the above research.",

        contentChunks: [],

      });
      const podCastMessageId = nanoid();
      const podcastObject = { title, researchId };
      const podcastMessage: Message = {
        id: podCastMessageId,
        threadId: THREAD_ID,
        role: "assistant",
        agent: "podcast",
        content: JSON.stringify(podcastObject),

        contentChunks: [],

        reasoningContent: "",

        reasoningContentChunks: [],

        isStreaming: true,
      };
      appendMessage(podcastMessage);
      // Generating podcast...
      let audioUrl: string | undefined;
      try {
        audioUrl = await generatePodcast(reportMessage.content);
      } catch (e) {
        console.error(e);
        useStore.setState((state) => ({
          messages: new Map(useStore.getState().messages).set(
            podCastMessageId,
            {
              ...state.messages.get(podCastMessageId)!,
              content: JSON.stringify({
                ...podcastObject,
                error: e instanceof Error ? e.message : "Unknown error",
              }),
              isStreaming: false,
            },
          ),
        }));
        toast("An error occurred while generating podcast. Please try again.");
        return;
      }
      useStore.setState((state) => ({
        messages: new Map(useStore.getState().messages).set(podCastMessageId, {
          ...state.messages.get(podCastMessageId)!,
          content: JSON.stringify({ ...podcastObject, audioUrl }),
          isStreaming: false,
        }),
      }));
    }
  }
}

export function useResearchMessage(researchId: string) {
  return useStore(
    useShallow((state) => {
      const messageId = state.researchPlanIds.get(researchId);
      return messageId ? state.messages.get(messageId) : undefined;
    }),
  );
}

export function useMessage(messageId: string | null | undefined) {
  return useStore(
    useShallow((state) =>
      messageId ? state.messages.get(messageId) : undefined,
    ),
  );
}

export function useMessageIds() {
  return useStore(useShallow((state) => state.messageIds));
}

export function useLastInterruptMessage() {
  return useStore(
    useShallow((state) => {
      if (state.messageIds.length >= 2) {
        const lastMessage = state.messages.get(
          state.messageIds[state.messageIds.length - 1]!,
        );
        return lastMessage?.finishReason === "interrupt" ? lastMessage : null;
      }
      return null;
    }),
  );
}

export function useLastFeedbackMessageId() {
  const waitingForFeedbackMessageId = useStore(
    useShallow((state) => {
      if (state.messageIds.length >= 2) {
        const lastMessage = state.messages.get(
          state.messageIds[state.messageIds.length - 1]!,
        );
        if (lastMessage && lastMessage.finishReason === "interrupt") {
          return state.messageIds[state.messageIds.length - 2];
        }
      }
      return null;
    }),
  );
  return waitingForFeedbackMessageId;
}

export function useToolCalls() {
  return useStore(
    useShallow((state) => {
      return state.messageIds
        ?.map((id) => getMessage(id)?.toolCalls)
        .filter((toolCalls) => toolCalls != null)
        .flat();
    }),
  );
}

```

#### tutorial/web/src/core/utils/json.ts

修改内容：完整覆盖：只有 JSON 外形才进入容错解析。

```typescript
import { parse } from "best-effort-json-parser";

export function parseJSON<T>(json: string | null | undefined | any, fallback: T) {
  if (!json) {
    return fallback;
  }
  // 确保 json 是字符串类型
  const jsonStr = typeof json !== 'string' ? String(json) : json;
  try {
    const raw = jsonStr
      .trim()
      .replace(/[\s\S]*```json\s*/, "")
      .replace(/^```js\s*/, "")
      .replace(/^```ts\s*/, "")
      .replace(/^```plaintext\s*/, "")
      .replace(/^```\s*/, "")
      .replace(/\s*```$/, "");
    // 当前调用点只消费 JSON 对象/数组。工具的纯文本结果
    // （例如“未搜到……”）直接回退，不交给 best-effort parser 拆分。
    if (!raw.startsWith("{") && !raw.startsWith("[")) {
      return fallback;
    }
    try {
      return parse(raw) as T;
    } catch (parseError) {
      console.error('Failed to parse JSON:', {
        error: parseError,
        originalContent: jsonStr,
        cleanedContent: raw
      });
      return fallback;
    }
  } catch (error) {
    console.error('Error while processing JSON string:', {
      error,
      originalContent: jsonStr
    });
    return fallback;
  }
}

```

#### tutorial/web/src/components/deer-flow/link.tsx

修改内容：完整覆盖：错误工具文本不再进入链接 JSON 扫描。

```tsx
import { useMemo } from "react";
import { useStore, useToolCalls } from "~/core/store";
import { parseJSON } from "~/core/utils/json";
import { Tooltip } from "./tooltip";
import { WarningFilled } from "@ant-design/icons";
import { useTranslations } from "next-intl";

export const Link = ({
  href,
  children,
  checkLinkCredibility = false,
}: {
  href: string | undefined;
  children: React.ReactNode;
  checkLinkCredibility: boolean;
}) => {
  const toolCalls = useToolCalls();
  const responding = useStore((state) => state.responding);

  const credibleLinks = useMemo(() => {
    const links = new Set<string>();
    if (!checkLinkCredibility) return links;


    (toolCalls || []).forEach((call) => {

      if (
        call &&
        call.name === "web_search" &&
        typeof call.result === "string" &&
        !call.result.startsWith("Error:")
      ) {
        try {

          const result = parseJSON(call.result, []) as Array<{ url: string }>;

          if (Array.isArray(result)) {
            result.forEach((r) => {
              if (r && typeof r.url === 'string') {
                // encodeURI is used to handle the case where the link contains chinese or other special characters
                links.add(encodeURI(r.url));
                links.add(r.url);
              }
            });
          }
        } catch (error) {
          console.warn('Failed to parse web_search result:', error);
        }
      }
    });
    return links;
  }, [toolCalls]);

  const isCredible = useMemo(() => {
    return checkLinkCredibility && href && !responding
      ? credibleLinks.has(href)
      : true;
  }, [credibleLinks, href, responding, checkLinkCredibility]);

  const t = useTranslations("common");
  return (
    <span className="inline-flex items-center gap-1.5">
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
      {!isCredible && (
        <Tooltip title={t("linkNotReliable")} delayDuration={300}>
          <WarningFilled className="text-sx transition-colors hover:!text-yellow-500" />
        </Tooltip>
      )}
    </span>
  );
};

```

#### tutorial/web/src/app/chat/components/research-activities-block.tsx

修改内容：完整覆盖：检索结果、chunk 分值、direct-output 和报告审核交互。

```tsx
// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { PythonOutlined } from "@ant-design/icons";
import { motion } from "framer-motion";
import { LRUCache } from "lru-cache";
import {
  BookOpenText,
  Check,
  ChevronDown,
  CircleAlert,
  FileText,
  Loader,
  PencilRuler,
  Search,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { docco } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { dark } from "react-syntax-highlighter/dist/esm/styles/prism";

import { Button, Col, Form, Input, InputNumber, Row } from "antd";
import { ContentDialog } from "~/app/chat/components/content-dialog";
import { FavIcon } from "~/components/deer-flow/fav-icon";
import Image from "~/components/deer-flow/image";
import { LoadingAnimation } from "~/components/deer-flow/loading-animation";
import { Markdown } from "~/components/deer-flow/markdown";
import { RainbowText } from "~/components/deer-flow/rainbow-text";
import { Tooltip } from "~/components/deer-flow/tooltip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { Skeleton } from "~/components/ui/skeleton";
import { findMCPTool } from "~/core/mcp";
import type { EvaluationResult, ToolCallRuntime } from "~/core/messages";
import { sendMessage, useMessage, useStore, useToolCalls } from "~/core/store";
import { getChatStreamSettings } from "~/core/store/settings-store";
import { parseJSON } from "~/core/utils";
import { processContent } from "~/core/utils/markdown";
import { cn } from "~/lib/utils";
import type { Message } from "../../../core/messages";
import { CollapseBlock } from "./CollapseBlock";
import { ThoughtBlock } from "./ThoughtBlock";
let timerRef: any = null; // 用于存储定时器的引用

export function ResearchActivitiesBlock({
  className,
  researchId,
}: {
  className?: string;
  researchId: string;
}) {
  const activityIds = useStore((state) =>
    state.researchActivityIds.get(researchId),
  )!;

  const ongoing = useStore((state) => state.ongoingResearchId === researchId);
  const messages = useStore((state) => state.messages);

  // 按步骤分组 activityIds，每个步骤只渲染一个容器
  const groupedActivities: any = {};
  // 获取所有步骤键，用于确定当前活动步骤

  const stepKeys: string[] = [];


  // 添加空值检查，避免 activityIds 为 undefined
  if (activityIds && activityIds.length > 0) {
    activityIds.forEach((activityId, index) => {
      // 跳过第一个活动项（通常是起始项）
      if (index === 0) return;

      const message = messages.get(activityId);
      // 提取步骤标识：step1, step2, step3 等
      const stepMatch = message?.step?.match(/^step(\S+)/i);
      const stepKey: any = stepMatch ? stepMatch[1] : "other";
      // 安全地初始化数组并添加 activityId
      if (!groupedActivities[stepKey]) {
        groupedActivities[stepKey] = {

          ids: [],

          title: message?.step_title || "",
        };
        if (stepKey !== "other") {
          stepKeys.push(stepKey);
        }
      }
      groupedActivities[stepKey]!.ids.push(activityId);
      if (message?.agent && message?.agent == "reporter") {
      }
    });
  }

  // 排序步骤键，确定当前活动步骤（最后一个步骤）
  stepKeys.sort((a, b) => parseInt(a) - parseInt(b));

  // 检查是否有 reporter 消息，如果有则所有步骤都已完成
  const hasReporterMessage = activityIds.some((activityId) => {
    const message = messages.get(activityId);
    return message?.agent === "reporter";
  });

  // 如果有 reporter 消息，则所有步骤都已完成，activeStep 设为 null
  // 否则 activeStep 设为最后一个步骤
  const activeStep: string | null = hasReporterMessage
    ? null
    : stepKeys.length > 0
      ? stepKeys[stepKeys.length - 1]!
      : null;

  return (
    <>
      <div className={cn("flex flex-col py-4", className)}>
        {Object.entries(groupedActivities).map(([stepKey, stepData]) => {
          const isStepContainer = stepKey !== "other";

          // 添加空值检查，确保 stepData 存在且不为空
          if (!stepData || !stepData.ids || stepData.ids.length === 0)
            return null;

          if (isStepContainer) {
            return (
              <StepContainer
                key={stepKey}
                stepKey={stepKey}
                activityIds={stepData.ids}
                stepTitle={stepData.title}
                activeStep={activeStep}
              />
            );
          }

          // 非步骤消息直接渲染 ActivityItem
          return stepData.ids.map((activityId, index) => (
            <ActivityItem
              key={activityId}
              activityId={activityId}
              index={index}
              stepKey={stepKey}
              isLast={index === stepData.ids.length - 1}
            />
          ));
        })}
      </div>
      {ongoing && !hasReporterMessage && <LoadingAnimation className="mx-4 my-12" />}
    </>
  );
}

export function EvaluationDisplay({
  evaluation,
}: {
  evaluation: EvaluationResult;
}) {
  const t = useTranslations("chat.research");

  // 根据评分显示不同的颜色
  const getScoreColor = (score?: number) => {
    if (!score) return "text-muted-foreground";
    if (score >= 0.8) return "text-green-600";
    if (score >= 0.6) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreIcon = (score?: number) => {
    if (!score) return "📊";
    if (score >= 0.8) return "✅";
    if (score >= 0.6) return "⚠️";
    return "❌";
  };

  const getBgColor = (score?: number) => {
    if (!score) return "bg-muted/30";
    if (score >= 0.8) return "bg-green-50 dark:bg-green-950/30";
    if (score >= 0.6) return "bg-yellow-50 dark:bg-yellow-950/30";
    return "bg-red-50 dark:bg-red-950/30";
  };

  const getBorderColor = (score?: number) => {
    if (!score) return "border-muted";
    if (score >= 0.8) return "border-green-200 dark:border-green-800";
    if (score >= 0.6) return "border-yellow-200 dark:border-yellow-800";
    return "border-red-200 dark:border-red-800";
  };

  // 如果没有完整的评估数据，显示基本信息
  if (
    !evaluation.qualityScore &&
    !evaluation.stepTitle &&
    !evaluation.feedback
  ) {
    return (
      <motion.div
        className="bg-muted/20 border-border mt-3 rounded-lg border p-4"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <span>📊</span>
          <span>{evaluation.result || "暂无评估结果"}</span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className={`bg-card mt-3 overflow-hidden rounded-lg border shadow-sm transition-all duration-200 hover:shadow-md ${getBorderColor(evaluation.qualityScore)}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {/* 评分头部 */}
      <div className={`px-4 py-3 ${getBgColor(evaluation.qualityScore)}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-foreground text-base font-medium">
              评估结果
            </span>
          </div>
          {evaluation.qualityScore && (
            <div
              className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${getScoreColor(evaluation.qualityScore).replace("text-", "bg-").replace("600", "100")} ${getScoreColor(evaluation.qualityScore)}`}
            >
              {(evaluation.qualityScore * 100).toFixed(0)} 分
            </div>
          )}
        </div>
      </div>

      <div className="p-4">
        {/* 步骤信息 */}
        {evaluation.stepTitle && (
          <div className="mb-4">
            <div className="flex items-start gap-3">
              <div className="bg-primary/10 text-primary mt-0.5 flex h-5 w-5 items-center justify-center rounded-full">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="lucide lucide-list-checks"
                >
                  <path d="m3 17 2 2 4-4" />
                  <path d="m3 7 2 2 4-4" />
                  <path d="M13 6h8" />
                  <path d="M13 12h8" />
                  <path d="M13 18h8" />
                </svg>
              </div>
              <div>
                <p className="text-muted-foreground text-sm font-medium">
                  步骤
                </p>
                <p className="text-foreground text-sm">
                  {evaluation.stepTitle}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 反馈内容 */}
        {evaluation.feedback && (
          <div className="mb-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="lucide lucide-message-circle"
                >
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-muted-foreground mb-1 text-sm font-medium">
                  反馈建议
                </p>
                <p className="text-foreground text-sm leading-relaxed">
                  {evaluation.feedback}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 时间戳 */}
        {evaluation.evaluationTimestamp && (
          <div className="text-muted-foreground border-border/50 flex items-center gap-2 border-t pt-3 text-xs">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-clock"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>
              {new Date(evaluation.evaluationTimestamp).toLocaleString(
                "zh-CN",
                {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                },
              )}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
// 最终评估结果
export function EvaluationFinally({
  evaluation,
}: {
  evaluation: any;
}) {
  return (
    <section className="evaluation-result-box">
      <div className="evaluation-top">
        <div className="evaluation-title flex items-center gap-2">
          <span className="evaluation-title-icon bg-[url('/images/result-title.png')]"></span>
          <span>{evaluation?.evaluatorName}</span>
        </div>
      </div>
      <div className="evaluation-content">
        <div>反馈建议：</div>
        {evaluation?.feedback}
      </div>
      <div className="evaluation-footer">
        评估时间：{evaluation?.evaluationTimestamp}
      </div>
      <div className="evaluation-mark-icon bg-[url('/images/result-bg.png')]">{(evaluation.qualityScore * 100).toFixed(0)} 分</div>
    </section>
  )
}

function ActivityMessage({ messageId }: { messageId: string }) {
  const message = useMessage(messageId);
  if (
    message?.agent &&
    message.content &&
    (!message?.finishReason || message?.finishReason != "interrupt")
  ) {
    if (message.agent !== "reporter" && message.agent !== "planner") {
      // 添加内容处理逻辑
      const processedContent = processContent(message.content);
      return (
        <div className="px-4 py-2">
          <Markdown animated checkLinkCredibility>
            {processedContent}
          </Markdown>
        </div>
      );
    }
  }
  return null;
}
// 思考过程
function ThinkMessage({ messageId }: { messageId: string }) {
  const messages = useStore((state) => state.messages);
  const message: any = useMessage(messageId);
  const reasoningContent = message.reasoningContent;
  const hasMainContent = Boolean(
    message.content && message.content.trim() !== "",
  );

  const isLastMessage = useMemo(() => {
    const messageIds = Array.from(messages.keys());
    return messageIds.length > 0 && messageIds[messageIds.length - 1] === messageId;
  }, [messages, messageId]);

  const isThinking = Boolean(reasoningContent && !hasMainContent && isLastMessage);

  if (reasoningContent) {
    return (
      <ThoughtBlock
        content={reasoningContent}
        isStreaming={isThinking}
      />
    );
  }
  return null;
}

//  知识库来源
function ActivityDatasetList({ messageId }: { messageId: string }) {
  const message = useMessage(messageId);
  if (
    message?.agent &&
    message.content &&
    !message.isStreaming &&
    message?.finishReason == "stop" &&
    message.agent !== "reporter" &&
    message.agent !== "planner"
  ) {
    const datasetList = extractResourceTitlesUnique(message.content);
    if (datasetList.length > 0) {
      return (
        <section className="dataset-section mt-4 pl-4">
          <div className="dataset-box-wrapper">
            <div className="dataset-box-title flex items-center">
              <img
                src="./images/dataset.png"
                className="dataset-box-title-icon"
                alt=""
              />
              <span className="ml-[6px]">知识库来源：</span>
            </div>
            <div className="dataset-box-content">
              {datasetList.map((item: any, index: number) => {
                return (
                  <div className="dataset-box-content-item" key={index}>
                    <img
                      src="./images/dataset-item.png"
                      className="dataset-box-content-img"
                      alt=""
                    />
                    <span className="dataset-box-content-txt">{item}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      );
    }
  }
  return null;
}


/**
 * 从 markdown 表格里摘出“资源标题”列（自动去重）
 * @param {string} md 完整的 markdown 字符串

 * @returns {string[]} 该列所有非空标题，找不到返回 [ ]

 */
function extractResourceTitlesUnique(md = "") {

  if (typeof md !== "string") return [];


  // 找到表格的起始位置
  const tableStart = md.indexOf("| 标题");

  if (tableStart === -1) return [];


  // 找到表格的结束位置（下一个空行或文档结束）
  const tableEnd = md.indexOf("\n\n", tableStart);
  const tableContent = tableEnd === -1 ? md.substring(tableStart) : md.substring(tableStart, tableEnd);

  // 将表格内容按行分割
  const lines = tableContent.split("\n");

  // 查找表格分隔符行的索引
  const separatorIdx = lines.findIndex((line) =>
    /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line)
  );

  // 如果没有找到分隔符行，或者分隔符行之前没有标题行，返回空数组

  if (separatorIdx < 1) return [];


  // 解析表头
  const headerCells = lines[separatorIdx - 1]
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  // 查找标题列的索引
  const titleColIdx = headerCells.findIndex((h) => h.toLowerCase() === "标题");

  if (titleColIdx === -1) return [];



  const titles = []; // 存储标题数据


  // 遍历表格数据行
  for (let i = separatorIdx + 1; i < lines.length; i++) {
    const cells = lines[i]
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    // 如果当前行的单元格数量不足以包含标题列，跳过
    if (cells.length <= titleColIdx) continue;
    const cell = cells[titleColIdx];
    if (cell) titles.push(cell);
  }

  return titles; // 返回标题数组
}


export function NoRetrievedActivityMessage({
  messageId,
}: {
  messageId: string;
}) {
  const message: any = useMessage(messageId);
  const formRef = useRef<any>(null);
  const [form] = Form.useForm();
  const [disabled, setDisabled] = useState(false);
  const review = message?.additional_info?.retrieval_review;

  const documents = Array.isArray(review?.documents) ? review.documents : [];

  const initialValues = {
    human_retriever_query: review?.query || "",
    human_retriever_similarity:
      review?.similarity ?? getChatStreamSettings()?.retriever_similarity ?? 0.4,
  };
  // 检查是否应该显示组件
  const shouldShow = useMemo(() => {
    return message &&
      message.finishReason &&
      message.finishReason == "interrupt" &&
      message.nodeType &&
      message.nodeType == "retriever_review";
  }, [message]);
  const handleRetrySearch = async () => {
    if (disabled) {
      return;
    }
    setDisabled(true); // 设置按钮为不可点击
    const values = formRef.current?.getFieldsValue();
    try {
      await sendMessage("重新检索", {
        interruptFeedback: "reselect",
        silent: true,
        param_list: [
          {
            name: "human_retriever_similarity",
            value: String(values?.human_retriever_similarity),
          }, // 必须是字符串类型，否则会报错
          {
            name: "human_retriever_query",
            value: values?.human_retriever_query || "",
          }, // 如果没有输入值，去关键词的第一个，也没有取空值
        ],
      });

    } catch {
      setDisabled(false);
    }
  };
  const handleAccept = async () => {
    if (disabled) return;
    setDisabled(true);
    try {
      await sendMessage("接受知识库检索结果", {
        interruptFeedback: "continue",
        silent: true,
      });
    } catch {
      setDisabled(false);
    }
  };
  const onReset = () => {
    formRef.current?.resetFields(); // 回到 initialValues
  };

  // 仅在满足条件时显示
  if (shouldShow) {
    return (
      <section className="mt-4 pl-4">
        <div className="dataset-box">
          <div className="dataset-box-empty">
            <div className="dataset-box-empty-tips flex items-center justify-center">
              <CircleAlert size={15} className="dataset-box-empty-tips-icon" />
              <span>
                {documents.length > 0
                  ? `已检索到 ${documents.length} 个知识库文档，请确认是否采用。`
                  : "当前没有检索到相关知识库来源，可修改参数重检或跳过。"}
              </span>
            </div>
            {documents.length > 0 && (
              <div className="px-4 pt-4">
                <div className="mb-2 text-sm text-muted-foreground">
                  关键词：{review?.query || "-"}；相似度阈值：
                  {Number(review?.similarity ?? 0).toFixed(3)}
                </div>
                <div className="space-y-2">
                  {documents.map((doc: any, index: number) => (
                    <div key={doc.id || index} className="rounded-md border p-3">
                      <div className="font-medium">{doc.title || `文档 ${index + 1}`}</div>
                      <div className="text-xs text-muted-foreground">
                        来源：{doc.resource_title || "未知"}
                      </div>

                      {(doc.chunks || []).slice(0, 3).map((chunk: any, chunkIndex: number) => (

                        <div key={chunkIndex} className="mt-2 text-sm">
                          <span className="font-medium">
                            分值：{typeof chunk.similarity === "number" ? chunk.similarity.toFixed(4) : "-"}
                          </span>
                          <div className="line-clamp-2 text-muted-foreground">{chunk.content}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="dataset-box-empty-form">
              <Form
                ref={formRef}
                form={form}
                layout="vertical"
                initialValues={initialValues}
              >
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item
                      label="检索关键词"
                      name="human_retriever_query"
                      rules={[{ required: false, message: "请输入检索关键词" }]}
                    >
                      <Input placeholder="请输入检索关键词" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item
                      label="相似度高于"
                      name="human_retriever_similarity"
                      rules={[{ required: false, message: "请输入相似度高于" }]}
                    >
                      <InputNumber
                        min={0}
                        max={1}
                        controls={true}
                        step={0.1} // 每次按键步进 0.1
                        precision={3} // 强制保留 3 位小数
                        formatter={(val) => Number(val).toFixed(3)} // 失去焦点时也保持 3 位
                        className="width-full"
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Col span={24}>
                  <div className="submit-btn-box flex justify-center">
                    <Button
                      className="submit-btn-cancel-ant"
                      onClick={onReset}
                      disabled={disabled}
                    >
                      重置参数
                    </Button>
                    <Button
                      className="submit-btn-shure-ant ml-2.5"
                      type="primary"
                      onClick={handleRetrySearch}
                      disabled={disabled}
                    >
                      修改后重新检索
                    </Button>
                    <Button
                      className="submit-btn-shure-ant ml-2.5"
                      type="primary"
                      onClick={handleAccept}
                      disabled={disabled}
                    >
                      {documents.length > 0 ? "接受并继续" : "跳过知识库继续"}
                    </Button>
                  </div>
                </Col>
              </Form>
            </div>
          </div>
        </div>
      </section>
    );
  }
  return null;
}

export function LlmOutputActivityMessage({
  messageId,
}: {
  messageId: string;
}) {
  const messages = useStore((state) => state.messages);
  const message: any = useMessage(messageId);
  const formRef = useRef<any>(null);
  const [form] = Form.useForm();
  const [disabled, setDisabled] = useState(false);
  const [isVisible, setIsVisible] = useState(true); // 默认显示
  const [count, setCount] = useState(30); // 初始化为30秒
  const initialValues = {
    human_retriever_query: "",
    human_retriever_similarity: getChatStreamSettings()?.retriever_similarity || 0.4,
  };
  const urlParams = new URLSearchParams(window.location.search);
  // 检查是否应该显示组件
  const shouldShow = useMemo(() => {
    return isVisible &&
      message &&
      message.finishReason &&
      message.finishReason == "interrupt" &&
      message.nodeType &&
      message.nodeType == "llm_output_review";
  }, [message, isVisible]);
  let timer: any = null;
  /* --------- 统一的倒计时逻辑 --------- */
  useEffect(() => {
    // 只有在应该显示组件时才执行倒计时逻辑
    if (shouldShow) {
      document.querySelectorAll('.documents-empty').forEach((el, i, arr) => i === arr.length - 1 && (el.style.display = 'none'));
      if (count > 0) {
        timer = setTimeout(() => {
          setCount(count - 1);
        }, 1000);
        return () => clearTimeout(timer);
      } else {
        handleOutputMode(true);
      }
    }
  }, [count, shouldShow]);

  // 组件每次显示时重新开始倒计时
  useEffect(() => {
    // 只有在应该显示组件时才重置倒计时
    if (shouldShow) {
      setCount(30);
    }
    // 如果是回放 不展示倒计时
    if (urlParams.has("thread_id")) {
      timer && clearTimeout(timer);
      timer = null;
      setCount(0);       // 设置倒计时为0
      setDisabled(true); // 设置按钮为不可点击
    }
  }, [shouldShow]);

  const handleOutputMode = async (isDirectOutput: boolean) => {
    clearTimeout(timer);
    if (disabled) {
      return;
    }
    setDisabled(true); // 设置按钮为不可点击
    setCount(0);
    try {
      sendMessage(isDirectOutput ? "模型直接回答" : "不使用模型回答", {
        interruptFeedback: "continue",
        silent: true,
        param_list: [
          {
            name: "direct_output",
            value: isDirectOutput ? "true" : "false",
          }, // 必须是字符串类型，否则会报错
        ],
      });
      // 发送消息成功后隐藏组件
      // setIsVisible(false);
    } catch { }
  };

  // 仅在满足条件时显示
  if (shouldShow) {
    return (
      <section className="mt-4 pl-4">
        <div className="dataset-box">
          <div className="dataset-box-empty">
            <div className="dataset-box-empty-tips flex items-center justify-center">
              <CircleAlert size={15} className="dataset-box-empty-tips-icon" />
              <span>
                当前没有检索到背景知识，请选择是否由模型直接回答！
              </span>
              {count > 0 && <span>倒计时：{count}S</span>}
            </div>
            <div className="dataset-box-empty-form">
              <Form
                ref={formRef}
                form={form}
                layout="vertical"
                initialValues={initialValues}
              >
                <Col span={24}>
                  <div className="submit-btn-box flex justify-center">
                    <Button
                      className="submit-btn-cancel-ant"
                      onClick={() => handleOutputMode(false)}
                      disabled={disabled}
                    >
                      否
                    </Button>
                    <Button
                      className="submit-btn-shure-ant ml-2.5"
                      type="primary"
                      onClick={() => handleOutputMode(true)}
                      disabled={disabled}
                    >
                      是
                    </Button>
                  </div>
                </Col>
              </Form>
            </div>
          </div>
        </div>
      </section>
    );
  }
  return null;
}

function ReportReviewActivityMessage({ messageId }: { messageId: string }) {
  const message: any = useMessage(messageId);
  const [disabled, setDisabled] = useState(false);
  const shouldShow =
    message?.finishReason === "interrupt" &&
    message?.nodeType === "report_review";

  if (!shouldShow) {
    return null;
  }

  const resumeReport = async (feedback: "accepted" | "continue") => {
    if (disabled) return;
    setDisabled(true);
    try {
      await sendMessage(
        feedback === "accepted" ? "接受报告" : "重新生成报告",
        { interruptFeedback: feedback, silent: true },
      );
    } catch {
      setDisabled(false);
    }
  };

  return (
    <section className="mt-4 pl-4">
      <div className="dataset-box">
        <div className="dataset-box-empty">
          <div className="dataset-box-empty-tips flex items-center justify-center">
            <CircleAlert size={15} className="dataset-box-empty-tips-icon" />
            <span>报告已生成，请确认是否接受。</span>
          </div>
          <div className="submit-btn-box flex justify-center">
            <Button
              className="submit-btn-cancel-ant"
              onClick={() => void resumeReport("continue")}
              disabled={disabled}
            >
              重新生成
            </Button>
            <Button
              className="submit-btn-shure-ant ml-2.5"
              type="primary"
              onClick={() => void resumeReport("accepted")}
              disabled={disabled}
            >
              接受报告
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ActivityListItem({ messageId }: { messageId: string }) {
  const message: Message | undefined = useMessage(messageId);

  if (message) {
    if (!message.isStreaming && message.toolCalls?.length) {
      const toolCallComponents = message.toolCalls
        .filter(
          (toolCall) =>
            toolCall.result !== undefined &&
            !(
              typeof toolCall.result === "string" &&
              toolCall.result?.startsWith("Error")
            ),
        )
        .map((toolCall) => {
          if (toolCall.name === "web_search") {
            return <WebSearchToolCall key={toolCall.id} toolCall={toolCall} />;
          } else if (toolCall.name === "crawl_tool") {
            return <CrawlToolCall key={toolCall.id} toolCall={toolCall} />;
          } else if (toolCall.name === "python_repl_tool") {
            return <PythonToolCall key={toolCall.id} toolCall={toolCall} />;
          } else if (toolCall.name === "local_search_tool") {
            return (
              <RetrieverToolCall
                key={toolCall.id}
                toolCall={toolCall}
                messageId={messageId}
              />
            );
          } else {
            return <MCPToolCall key={toolCall.id} toolCall={toolCall} />;
          }
        });

      if (toolCallComponents.length > 0) {
        return <>{toolCallComponents}</>;
      }
    }
    if (message.agent === "eval" && message.evaluation) {
      return (
        <div className="px-4 py-2">
          <EvaluationDisplay evaluation={message.evaluation} />
        </div>
      );
    }
  }
  return null;
}

function ActivityKeywords({ messageId }: { messageId: string }) {
  const message = useMessage(messageId);
  if (message) {
    if (!message.isStreaming && message.toolCalls?.length) {
      for (const toolCall of message.toolCalls) {
        switch (toolCall.name) {
          case "local_search_tool":
            return <KeywordsList key={toolCall.id} toolCall={toolCall} />;
          default:
            return null;
        }
      }
    }
    return null;
  }
}

const __pageCache = new LRUCache<string, string>({ max: 100 });
type SearchResult =
  | {
    type: "page";
    title: string;
    url: string;
    content: string;
  }
  | {
    type: "image";
    image_url: string;
    image_description: string;
  };

function WebSearchToolCall({ toolCall }: { toolCall: ToolCallRuntime }) {
  const t = useTranslations("chat.research");
  const searching = useMemo(() => {
    return toolCall.result === undefined;
  }, [toolCall.result]);

  const searchResults = useMemo<SearchResult[]>(() => {


    let results: SearchResult[] | undefined  = undefined;

    try {

      results = toolCall.result ? parseJSON(toolCall.result, []) : undefined ;

    } catch {
      results = undefined;
    }
    if (Array.isArray(results)) {
      results.forEach((result) => {
        if (result.type === "page") {
          __pageCache.set(result.url, result.title);
        }
      });
    } else {

      results = [];

    }
    return results;
  }, [toolCall.result]);
  const pageResults = useMemo(
    () => searchResults?.filter((result) => result.type === "page"),
    [searchResults],
  );
  const imageResults = useMemo(
    () => searchResults?.filter((result) => result.type === "image"),
    [searchResults],
  );
  return (
    <section className="mt-4 pl-4">
      <div className="font-medium italic">
        <RainbowText
          className="flex items-center"
          animated={searchResults === undefined}
        >
          <Search size={16} className={"mr-2"} />
          <span>{t("searchingFor")}&nbsp;</span>
          <span className="max-w-[500px] overflow-hidden text-ellipsis whitespace-nowrap">
            {(toolCall.args as { query: string }).query}
          </span>
        </RainbowText>
      </div>
      <div className="pr-4">
        {pageResults && (
          <ul className="mt-2 flex flex-wrap gap-4">
            {searching &&
              [...Array(6)].map((_, i) => (
                <li
                  key={`search-result-${i}`}
                  className="flex h-40 w-40 gap-2 rounded-md text-sm"
                >
                  <Skeleton
                    className="to-accent h-full w-full rounded-md bg-gradient-to-tl from-slate-400"
                    style={{ animationDelay: `${i * 0.2}s` }}
                  />
                </li>
              ))}
            {pageResults
              .filter((result) => result.type === "page")
              .map((searchResult, i) => (
                <motion.li
                  key={`search-result-${i}`}
                  className="text-muted-foreground bg-accent flex max-w-40 gap-2 rounded-md px-2 py-1 text-sm"
                  initial={{ opacity: 0, y: 10, scale: 0.66 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{
                    duration: 0.2,
                    delay: i * 0.1,
                    ease: "easeOut",
                  }}
                >
                  <FavIcon
                    className="mt-1"
                    url={searchResult.url}
                    title={searchResult.title}
                  />
                  <a href={searchResult.url} target="_blank">
                    {searchResult.title}
                  </a>
                </motion.li>
              ))}
            {imageResults.map((searchResult, i) => (
              <motion.li
                key={`search-result-${i}`}
                initial={{ opacity: 0, y: 10, scale: 0.66 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{
                  duration: 0.2,
                  delay: i * 0.1,
                  ease: "easeOut",
                }}
              >
                <a
                  className="flex flex-col gap-2 overflow-hidden rounded-md opacity-75 transition-opacity duration-300 hover:opacity-100"
                  href={searchResult.image_url}
                  target="_blank"
                >
                  <Image
                    src={searchResult.image_url}
                    alt={searchResult.image_description}
                    className="bg-accent h-40 w-40 max-w-full rounded-md bg-cover bg-center bg-no-repeat"
                    imageClassName="hover:scale-110"
                    imageTransition
                  />
                </a>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function CrawlToolCall({ toolCall }: { toolCall: ToolCallRuntime }) {
  const t = useTranslations("chat.research");
  const url = useMemo(
    () => (toolCall.args as { url: string }).url,
    [toolCall.args],
  );
  const title = useMemo(() => __pageCache.get(url), [url]);
  return (
    <section className="mt-4 pl-4">
      <div>
        <RainbowText
          className="flex items-center text-base font-medium italic"
          animated={toolCall.result === undefined}
        >
          <BookOpenText size={16} className={"mr-2"} />
          <span>{t("reading")}</span>
        </RainbowText>
      </div>
      <ul className="mt-2 flex flex-wrap gap-4">
        <motion.li
          className="text-muted-foreground bg-accent flex h-40 w-40 gap-2 rounded-md px-2 py-1 text-sm"
          initial={{ opacity: 0, y: 10, scale: 0.66 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            duration: 0.2,
            ease: "easeOut",
          }}
        >
          <FavIcon className="mt-1" url={url} title={title} />
          <a
            className="h-full flex-grow overflow-hidden text-ellipsis whitespace-nowrap"
            href={url}
            target="_blank"
          >
            {title ?? url}
          </a>
        </motion.li>
      </ul>
    </section>
  );
}

function RetrieverToolCall({
  toolCall,
  messageId,
}: {
  toolCall: ToolCallRuntime;
  messageId: any;
}) {
  const t = useTranslations("chat.research");
  const ContentDialogRef = useRef<any>(null);
  const searching = useMemo(() => {
    return toolCall.result === undefined;
  }, [toolCall.result]);

  // print first 200 characters of toolCall.result
  // console.log("RetrieverToolCall: toolCall.result",
  //   toolCall.result && typeof toolCall.result === 'string'
  //     ? toolCall.result.substring(0, 200)
  //     : toolCall.result
  // );
  const documents = useMemo<
    Array<{
      id: string;
      title: string;
      content: string;
      resource_title: string;
      chunks?: Array<{ content?: string; similarity?: number }>;
    }>
  >(() => {

    return toolCall.result ? parseJSON(toolCall.result, []) : [];

  }, [toolCall.result]);

  const formatSimilarity = (value: number | undefined) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "";
    return value.toFixed(4);
  };

  const buildChunksForDisplay = (doc: {
    content?: string;
    chunks?: Array<{ content?: string; similarity?: number }>;
  }) => {

    if (!doc.chunks || doc.chunks.length === 0) return [];

    return doc.chunks.map((chunk) => ({
      content: chunk.content ?? "",
      similarity: formatSimilarity(chunk.similarity),
    }));
  };
  // console.log('retriever_keyword1111111111111111111111 ')
  // console.log(toolCall)

  // 回显重新输入的关键词
  const queryWord = useMemo(() => {
    return toolCall.retriever_keyword || "";
  }, [toolCall.retriever_keyword]);

  // 知识库弹框显示内容
  const handleContentDialog = (val: any) => {
    if (val?.content) {
      ContentDialogRef?.current?.showDialog(val);
    }
  };
  return (
    <section
      className={`mt-4 pl-4 ${documents.length === 0 ? "empty-documents" : ""}`}
    >
      <div className="font-medium italic">
        <RainbowText className="flex items-center" animated={searching}>
          <Search size={16} className={"mr-2"} />
          <span>{t("retrievingDocuments")}&nbsp;</span>
          <span className="max-w-[500px] overflow-hidden text-ellipsis whitespace-nowrap">
            {queryWord
              ? queryWord
              : (toolCall.args as { keywords: string }).keywords}
          </span>
        </RainbowText>
      </div>
      <div className="pr-4">
        {documents && (
          <ul className="mt-2 flex flex-wrap gap-4">
            {searching &&
              [...Array(2)].map((_, i) => (
                <li
                  key={`search-result-${i}`}
                  className="flex h-40 w-40 gap-2 rounded-md text-sm"
                >
                  <Skeleton
                    className="to-accent h-full w-full rounded-md bg-gradient-to-tl from-slate-400"
                    style={{ animationDelay: `${i * 0.2}s` }}
                  />
                </li>
              ))}
            {documents?.map((doc, i) => (
              <motion.li
                key={`search-result-${i}`}
                className="text-muted-foreground bg-accent laiyuan-box flex gap-2 rounded-md px-2 py-1 text-sm"
                initial={{ opacity: 0, y: 10, scale: 0.66 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{
                  duration: 0.2,
                  delay: i * 0.1,
                  ease: "easeOut",
                }}
              >
                <FileText size={20} className="fileicon" />
                <div
                  className="laiyuan-content"
                  onClick={() => {
                    handleContentDialog?.({
                      ...doc,
                      chunks: buildChunksForDisplay(doc),
                    });
                  }}
                >
                  <div className="truncate" title={doc.title}>
                    {doc.title}
                  </div>
                  <div className="laiyuan-label">
                    <span>来源：</span>
                    <span className="laiyuan-value" title={doc?.resource_title}>
                      {doc?.resource_title}
                    </span>
                  </div>
                </div>
              </motion.li>
            ))}
          </ul>
        )}
        {documents?.length === 0 && (
          <div className="documents-empty pl-4 py-2">当前没有检索到相关知识库来源</div>
        )}
      </div>
      <ContentDialog ref={ContentDialogRef}></ContentDialog>
    </section>
  );
}
// 检索关键词 内容块
function KeywordsList({ toolCall }: { toolCall: ToolCallRuntime }) {
  // 检索关键字
  const keyWords: any = useMemo(() => {
    let array =

      (toolCall.args?.keywords as any)?.split(" ").filter(Boolean) || [];

    return array;
  }, [toolCall.args]);
  // console.log('retriever_keyword=============== ')
  // console.log(toolCall)
  const queryWord = useMemo(() => {
    return toolCall.retriever_keyword || "";
  }, [toolCall.retriever_keyword]);
  return (
    <section className="mt-4 pl-4">
      {/* 检索关键词 */}
      {keyWords.length > 0 && (
        <div className="key-words-box">
          <div className="key-words-title flex items-center">
            <img
              src="./images/word-search.png"
              className="key-words-icon"
              alt=""
            />
            <span className="ml-[6px]">检索关键词：</span>
          </div>
          <div className="key-words-content">
            {queryWord && (
              <div className="key-words-item">
                <span>{queryWord}</span>
              </div>
            )}
            {!queryWord &&
              keyWords.map((doc: any, i: any) => (
                <div className="key-words-item" key={`keyWords-item-${i}`}>
                  <span>{doc}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}
function PythonToolCall({ toolCall }: { toolCall: ToolCallRuntime }) {
  const t = useTranslations("chat.research");
  const code = useMemo<string | undefined>(() => {
    return (toolCall.args as { code?: string }).code;
  }, [toolCall.args]);
  const { resolvedTheme } = useTheme();
  return (
    <section className="mt-4 pl-4">
      <div className="flex items-center">
        <PythonOutlined className={"mr-2"} />
        <RainbowText
          className="text-base font-medium italic"
          animated={toolCall.result === undefined}
        >
          {t("runningPythonCode")}
        </RainbowText>
      </div>
      <div>
        <div className="bg-accent mt-2 max-h-[400px] max-w-[calc(100%-20px)] overflow-y-auto rounded-md p-2 text-sm">
          <SyntaxHighlighter
            language="python"
            style={resolvedTheme === "dark" ? dark : docco}
            customStyle={{
              background: "transparent",
              border: "none",
              boxShadow: "none",
            }}
          >
            {code?.trim() ?? ""}
          </SyntaxHighlighter>
        </div>
      </div>
      {toolCall.result && <PythonToolCallResult result={toolCall.result} />}
    </section>
  );
}

function PythonToolCallResult({ result }: { result: string }) {
  const t = useTranslations("chat.research");
  const { resolvedTheme } = useTheme();
  const hasError = useMemo(
    () => result.includes("Error executing code:\n"),
    [result],
  );
  const error = useMemo(() => {
    if (hasError) {
      const parts = result.split("```\nError: ");
      if (parts.length > 1) {
        return parts[1]!.trim();
      }
    }
    return null;
  }, [result, hasError]);
  const stdout = useMemo(() => {
    if (!hasError) {
      const parts = result.split("```\nStdout: ");
      if (parts.length > 1) {
        return parts[1]!.trim();
      }
    }
    return null;
  }, [result, hasError]);
  return (
    <>
      <div className="mt-4 font-medium italic">
        {hasError ? t("errorExecutingCode") : t("executionOutput")}
      </div>
      <div className="bg-accent mt-2 max-h-[400px] max-w-[calc(100%-20px)] overflow-y-auto rounded-md p-2 text-sm">
        <SyntaxHighlighter
          language="plaintext"
          style={resolvedTheme === "dark" ? dark : docco}
          customStyle={{
            color: hasError ? "red" : "inherit",
            background: "transparent",
            border: "none",
            boxShadow: "none",
          }}
        >
          {error ?? stdout ?? "(empty)"}
        </SyntaxHighlighter>
      </div>
    </>
  );
}

function MCPToolCall({ toolCall }: { toolCall: ToolCallRuntime }) {
  const tool = useMemo(() => findMCPTool(toolCall.name), [toolCall.name]);
  const { resolvedTheme } = useTheme();
  return (
    <section className="mt-4 pl-4">
      <div className="w-fit overflow-y-auto rounded-md py-0">
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="item-1">
            <AccordionTrigger>
              <Tooltip title={tool?.description}>
                <div className="flex items-center font-medium italic">
                  <PencilRuler size={16} className={"mr-2"} />
                  <RainbowText
                    className="pr-0.5 text-base font-medium italic"
                    animated={toolCall.result === undefined}
                  >
                    Running {toolCall.name ? toolCall.name + "()" : "MCP tool"}
                  </RainbowText>
                </div>
              </Tooltip>
            </AccordionTrigger>
            <AccordionContent>
              {toolCall.result && (
                <div className="bg-accent max-h-[400px] max-w-[560px] overflow-y-auto rounded-md text-sm">
                  <SyntaxHighlighter
                    language="json"
                    style={resolvedTheme === "dark" ? dark : docco}
                    customStyle={{
                      background: "transparent",
                      border: "none",
                      boxShadow: "none",
                    }}
                  >
                    {toolCall.result.trim()}
                  </SyntaxHighlighter>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </section>
  );
}

// 步骤容器组件 - 处理步骤的展开/收起功能
function StepContainer({
  stepKey,
  activityIds,
  stepTitle,
  activeStep,
}: {
  stepKey: string;

  activityIds: string[];

  stepTitle: string;
  activeStep: string | null;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="step-container mb-5" data-step={stepKey}>
      {/* 步骤头部 - 可点击展开/收起 */}
      <div className="step-content flex items-center justify-between p-3">
        <div className="flex items-center">
          <span className="flex items-center font-medium capitalize">
            <span className="step-status-box">
              {!activeStep ||
                (activeStep && parseInt(stepKey) < parseInt(activeStep)) ? (
                <Check size={12} className="step-status-icon" />
              ) : (
                <Loader size={12} className="step-status-icon animate-spin" />
              )}
            </span>
          </span>
          {!activeStep ||
            (activeStep && parseInt(stepKey) < parseInt(activeStep)) ? (
            <span className="step-title">
              步骤{Number(stepKey) + 1}：{stepTitle}
            </span>
          ) : (
            <span className="step-title">
              正在执行步骤{Number(stepKey) + 1}：{stepTitle}
            </span>
          )}
        </div>
        <span
          className="main-color flex cursor-pointer items-center"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <span>{isExpanded ? "收起" : "展开"}</span>
          <ChevronDown
            className={`transform transition-transform ${isExpanded ? "rotate-180" : ""
              }`}
          />
        </span>
      </div>
      {/* 步骤内容 - 可展开/收起 */}
      <motion.div
        initial={false}
        animate={{
          height: isExpanded ? "auto" : "300px",
          opacity: isExpanded ? 1 : 1,
        }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className="relative overflow-hidden"
        style={{ maxHeight: isExpanded ? "none" : "300px" }}
      >
        <div
          className={cn("transition-all duration-300", !isExpanded && "pb-6")}
        >
          <StepActivityItems activityIds={activityIds} stepKey={stepKey} />
        </div>

        {/* 收起时的渐变遮罩 */}
        {!isExpanded && (
          <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-8 bg-gradient-to-t from-white to-transparent dark:from-gray-900" />
        )}
      </motion.div>
    </div>
  );
}

// 步骤活动项组件 - 处理重试次数分组和折叠
function StepActivityItems({
  activityIds,
  stepKey,
}: {

  activityIds: string[];

  stepKey: string;
}) {
  const messages = useStore((state) => state.messages);

  // 按 step 相同且重试次数>0且重试次数相同的分组，保持默认顺序
  const groupedItems = useMemo(() => {

    const stepRetryGroups: { [key: string]: { [key: number]: any[] } } = {};


    const result: any[] = [];


    activityIds.forEach((activityId) => {
      const message = messages.get(activityId);
      const retryCount = Number(message?.additional_info?.re_execute_times || 0);
      const stepKey = message?.step || '';

      // 只有重试次数>0的才分组
      if (retryCount > 0) {
        // 按 step 和 重试次数分组
        if (!stepRetryGroups[stepKey]) {
          stepRetryGroups[stepKey] = {};
        }
        if (!stepRetryGroups[stepKey][retryCount]) {

          stepRetryGroups[stepKey][retryCount] = [];

        }
        stepRetryGroups[stepKey][retryCount].push({ activityId, retryCount, message, stepKey });
      } else {
        // 其他情况直接添加到结果中
        result.push({ activityId, retryCount, message, isDirect: true });
      }
    });

    // 将分组按重试次数排序后添加到结果中
    Object.keys(stepRetryGroups).forEach(stepKey => {
      Object.keys(stepRetryGroups[stepKey])
        .map(Number)
        .sort((a, b) => a - b)
        .forEach(retryCount => {
          result.push({
            stepKey,
            retryCount,
            items: stepRetryGroups[stepKey][retryCount],
            isGroup: true
          });
        });
    });

    return result;
  }, [activityIds, messages]);

  return (
    <div>
      {/* 按默认顺序渲染，step相同且重试次数>0的分组展示 */}
      {groupedItems.map((item, index) => {
        if (item.isGroup) {
          // step和重试次数分组，使用 CollapseBlock 包裹
          return (
            <CollapseBlock
              key={`${item.stepKey}-${item.retryCount}`}
              title={<span className="text-xl font-semibold text-black">{`第${item.retryCount}次重新执行`}</span>}
            >
              {item.items.map((groupItem: any, groupIndex: number) => (
                <ActivityItem
                  key={groupItem.activityId}
                  activityId={groupItem.activityId}
                  index={groupIndex}
                  stepKey={stepKey}
                  isLast={groupIndex === item.items.length - 1}
                />
              ))}
            </CollapseBlock>
          );
        } else {
          // 直接展示的项目
          return (
            <ActivityItem
              key={item.activityId}
              activityId={item.activityId}
              index={index}
              stepKey={stepKey}
              isLast={index === groupedItems.length - 1}
            />
          );
        }
      })}
    </div>
  );
}

// 单独的活动项组件 - 专注于内容渲染，不处理容器逻辑
function ActivityItem({
  activityId,
  index,
  isLast,
  stepKey,
}: {
  activityId: string;
  index: number;
  isLast: boolean;
  stepKey: string;

}) {
  const message: any = useMessage(activityId);
  if (!message) {
    console.log('message is undefined, activityId:', activityId);
    return null
  }
  if (message.agent === "reporter" || message.agent === "final_report_evaluator") {
    return null
  }
  return (
    <>
      <CurrentOutMessage messageId={activityId} />
      {
        message.agent == 'eval' && !message.finishReason ? null : <motion.li
          key={activityId}
          style={{ transition: "all 0.4s ease-out" }}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.4,
            ease: "easeOut",
          }}
          className="timeline-li"
          data-message-id={activityId}
        >
          {/* 思考模块 */}
          <ThinkMessage messageId={activityId} />
          {/* 没有背景知识时 */}
          <LlmOutputActivityMessage messageId={activityId} />
          {/* 最终报告审核 */}
          <ReportReviewActivityMessage messageId={activityId} />
          {/* markdown 模块 */}
          <ActivityMessage messageId={activityId} />
          {/* 关键词 */}
          <ActivityKeywords messageId={activityId} />
          {/* 有知识库时 */}
          <ActivityDatasetList messageId={activityId} />
          {/* 没有知识库时 */}
          <NoRetrievedActivityMessage messageId={activityId} />
          {/* 关键引用 */}
          <KnowledgeBaseLink messageId={activityId} stepKey={stepKey} />
          {/* 评价结果 */}
          <ActivityListItem messageId={activityId} key={activityId} />
          {!isLast && <hr className="my-8" />}
        </motion.li>
      }
    </>
  );
}
function KnowledgeBaseLink({ messageId, stepKey }: { messageId: string; stepKey: string }) {
  const message: any = useMessage(messageId);

  const [linkData, setLinkData] = useState<any>([])

  const toolCalls = useToolCalls();
  useEffect(() => {

    const newLinkData: any[] = [];

    toolCalls.forEach((item: any) => {
      if (item?.step && item?.step == (`step${stepKey}`) && item?.result) {
        try {
          let array = JSON.parse(item?.result)
          newLinkData.push(...array)
        } catch (error) {
          // 忽略解析错误
        }
      }
    })

    // 按 title 去重
    const uniqueLinkData = newLinkData.filter((item, index, arr) =>
      arr.findIndex(i => i.title === item.title) === index
    );

    // 只有当数据实际发生变化时才更新状态
    if (JSON.stringify(uniqueLinkData) !== JSON.stringify(linkData)) {
      setLinkData(uniqueLinkData)
    }
  }, [toolCalls, stepKey]) // 移除 linkData 依赖，避免无限循环
  if (!(message.agent === "researcher" && message.finishReason == 'stop')) {
    return null;
  }
  if (linkData.length == 0) {
    return null
  }
  return (
    <>
      <section className="mt-4 px-4 py-2">
        <div className="link-title bold text-[22px] font-bold">关键引用</div>
        <div className="link-content">
          {
            linkData.map((item: any, index: number) => {
              return (
                <div className="link-content-item flex items-center gap-2" key={item.id + '_' + index}>
                  <span className="link-content-item-mark"></span>
                  <a
                    href={`${item.url}&authTokenOnly=${item.authorization}`}
                    target="_blank"
                    className="text-blue-600 hover:text-blue-800 underline"
                  >
                    {item.title}
                  </a>
                </div>
              )
            })
          }
        </div>
      </section>
    </>
  )
}
// 显示当前任务的名称
function CurrentOutMessage({ messageId }: { messageId: string }) {
  const message: any = useMessage(messageId);
  if (message.additional_info?.activity?.activity_name) {
    if (message.agent === "eval" && message.finishReason) {
      return null
    }
    return (
      <div className="current-work-box">
        {message.additional_info?.activity?.activity_name}
      </div>
    )
  }
  return null
}

// 显示当前步骤重试的次数
function AgainCountMessage({ messageId }: { messageId: string }) {
  const message: any = useMessage(messageId);
  const result = Number(message.additional_info?.re_execute_times || 0);

  return result > 0 && message.agent === "researcher" ? (
    <div className={`again-work-box again-count-${result}`}>
      当前步骤重试次数：{result}
    </div>
  ) : null;
}

```

#### tutorial/web/src/app/chat/components/research-block.tsx

修改内容：完整覆盖：重试分组、skip 显示条件和请求反馈。

```tsx
// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { Check, Copy, Headphones, Pencil, Undo2, X, Download, FileText, FileCode, FileType } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import MarkdownIt from 'markdown-it';

import { ScrollContainer } from "~/components/deer-flow/scroll-container";
import { Tooltip } from "~/components/deer-flow/tooltip";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useReplay } from "~/core/replay";
import { closeResearch, listenToPodcast, useStore } from "~/core/store";
import { resolveServiceURL } from "~/core/api/resolve-service-url";
import { cn } from "~/lib/utils";
import { SkipForward } from "lucide-react";

import { ResearchActivitiesBlock } from "./research-activities-block";
import { ResearchReportBlock } from "./research-report-block";
import HtmlDownDialog from "./HtmlDownDialog";
import { processContent } from "~/core/utils/markdown"

export function ResearchBlock({
  className,
  researchId = null,
}: {
  className?: string;
  researchId: string | null;
}) {
  const dialogRef = useRef<any>(null);
  const t = useTranslations("chat.research");
  const messages = useStore((state) => state.messages);
  const researchActivityIds = useStore((state) => state.researchActivityIds);
  const activityIds = useMemo(

    () => (researchId ? (researchActivityIds.get(researchId) ?? []) : []),

    [researchActivityIds, researchId],
  );
  const reportId = useStore((state) =>
    researchId ? state.researchReportIds.get(researchId) : undefined,
  );
  const [activeTab, setActiveTab] = useState("activities");
  const hasReport = useStore((state) =>
    researchId ? state.researchReportIds.has(researchId) : false,
  );
  const reportStreaming = useStore((state) =>
    reportId ? (state.messages.get(reportId)?.isStreaming ?? false) : false,
  );
  const { isReplay } = useReplay();

  // 获取研究状态
  const ongoingResearchId = useStore((state) => state.ongoingResearchId);
  const threadId = useStore((state) => state.threadId);

  // 处理跳过执行的函数
  const [skipButtonText, setSkipButtonText] = useState("跳过执行");

  // 判断是否应该显示跳过按钮
  const showSkipButton = useMemo(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('thread_id')) {
      return false;
    }
    const currentMessages = activityIds.flatMap((id) => {
      const message = messages.get(id);

      return message ? [message] : [];

    });
    const hasReporter = currentMessages.some(msg => msg.agent === 'reporter');
    const lastMessage = [...currentMessages]
      .reverse()
      .find((message) =>
        ["researcher", "eval", "reporter"].includes(message.agent || ""),
      );
    const showButton =
      lastMessage?.agent === "researcher" &&
      Number(lastMessage?.additional_info?.re_execute_times || 0) > 0;
    if (showButton && !hasReporter) {
      return true
    }
    return false;
  }, [activityIds, messages]);
  useEffect(() => {
    if (!showSkipButton) {
      setSkipButtonText("跳过执行");
    }
  }, [showSkipButton]);
  const [checkpointId, setCheckpointId] = useState('');
  useEffect(() => {
    messages.forEach((value, key) => {
      if (
        value &&
        value.agent === 'final_report_evaluator' && value.checkpoint_id
      ) {
        setCheckpointId(value.checkpoint_id)
      }
    });
  }, [messages]);
  useEffect(() => {
    if (hasReport) {
      setActiveTab("report");
    }
  }, [hasReport]);

  const handleGeneratePodcast = useCallback(async () => {
    if (!researchId) {
      return;
    }
    await listenToPodcast(researchId);
  }, [researchId]);

  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    if (!reportId) {
      return;
    }
    const report = useStore.getState().messages.get(reportId);
    if (!report) {
      return;
    }
    void navigator.clipboard.writeText(report.content);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 1000);
  }, [reportId]);

  // Download report as markdown
  const handleDownloadMarkdown = useCallback(() => {
    if (!reportId) {
      return;
    }
    const report = useStore.getState().messages.get(reportId);
    if (!report) {
      return;
    }
    let reportContent = processContent(report.content);
    // 手动拼接 关键引用
    if (sessionStorage.getItem('knowledgeBaseLink')) {
      reportContent += sessionStorage.getItem('knowledgeBaseLink')
    }
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const filename = `research-report-${timestamp}.md`;
    const blob = new Blob([reportContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }, [reportId]);

  // Markdown to HTML conversion function with beautiful styling
  const markdownToHTML = (markdown: string): string => {
    // 创建 markdown-it 实例，启用常用插件
    const md = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true
    });

    // 将 markdown 转换为 HTML
    const convertedHTML = md.render(markdown);

    const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>研究报告</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #4f46e5, #7c3aed);
            color: white;
            padding: 40px;
            text-align: center;
        }
        .header h1 {
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 10px;
        }
        .header .timestamp {
            opacity: 0.9;
            font-size: 1rem;
        }
        .content {
            padding: 40px;
        }
        .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 {
            color: #4f46e5;
            margin: 30px 0 15px 0;
            font-weight: 600;
        }
        .content h1 {
            font-size: 2rem;
            border-bottom: 3px solid #4f46e5;
            padding-bottom: 10px;
        }
        .content h2 {
            font-size: 1.5rem;
        }
        .content h3 {
            font-size: 1.25rem;
        }
        .content p {
            margin-bottom: 16px;
            font-size: 1.1rem;
            color: #555;
        }
        .content ul, .content ol {
            margin: 16px 0;
            padding-left: 30px;
        }
        .content li {
            margin-bottom: 8px;
        }
        .content blockquote {
            border-left: 4px solid #4f46e5;
            padding-left: 20px;
            margin: 20px 0;
            background: #f8fafc;
            padding: 20px;
            border-radius: 0 8px 8px 0;
            font-style: italic;
        }
        .content code {
            background: #f1f5f9;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 0.9rem;
        }
        .content pre {
            background: #1e293b;
            color: #e2e8f0;
            padding: 20px;
            border-radius: 8px;
            overflow-x: auto;
            margin: 20px 0;
        }
        .content pre code {
            background: none;
            padding: 0;
            color: inherit;
        }
        .content table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .content th, .content td {
            padding: 12px;
            text-align: left;
            border: 1px solid #e2e8f0;
        }
        .content th {
            background: #4f46e5;
            color: white;
            font-weight: 600;
        }
        .content tr:nth-child(even) {
            background: #f8fafc;
        }
        .content a {
            color: #4f46e5;
            text-decoration: none;
        }
        .content a:hover {
            text-decoration: underline;
        }
        .content img {
            max-width: 100%;
            height: auto;
            border-radius: 8px;
            margin: 10px 0;
        }
        .content strong {
            font-weight: 600;
            color: #4f46e5;
        }
        .content em {
            font-style: italic;
        }
        .footer {
            text-align: center;
            padding: 20px;
            background: #f8fafc;
            color: #64748b;
            font-size: 0.9rem;
        }
        @media (max-width: 768px) {
            body {
                padding: 10px;
            }
            .header h1 {
                font-size: 2rem;
            }
            .content {
                padding: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>研究报告</h1>
            <div class="timestamp">生成时间: ${new Date().toLocaleString('zh-CN')}</div>
        </div>
        <div class="content">
            ${convertedHTML}
        </div>
        <div class="footer">
            本报告由 深思 生成
        </div>
    </div>
</body>
</html>`;
    return htmlContent;
  };

  // Download report as HTML
  const handleDownloadHTML = useCallback(() => {
    if (!reportId) {
      return;
    }
    const report = useStore.getState().messages.get(reportId);
    if (!report) {
      return;
    }
    let reportContent = processContent(report.content);
    // 手动拼接 关键引用
    if (sessionStorage.getItem('knowledgeBaseLink')) {
      reportContent += sessionStorage.getItem('knowledgeBaseLink')
    }
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const filename = `research-report-${timestamp}.html`;
    const htmlContent = markdownToHTML(reportContent);
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }, [reportId]);

  const onShowDownloadDrawer = useCallback(() => {
    if (!checkpointId) {
      return null;
    }
    dialogRef.current?.showDialog();
  }, [checkpointId]);

  const handleEdit = useCallback(() => {
    setEditing((editing) => !editing);

  }, []);




  const handleSkipExecution = useCallback(async () => {
    if (!threadId) {
      return;
    }
    setSkipButtonText("正在跳过...");
    try {
      const response = await fetch(resolveServiceURL("/api/chat/skip"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          thread_id: threadId,
        }),
      });

      if (!response.ok) {
        console.error("跳过执行失败:", response.statusText);
        setSkipButtonText("跳过失败，请重试");
      } else {
        setSkipButtonText("已请求跳过");
      }
    } catch (error) {
      console.error("跳过执行出错:", error);
      setSkipButtonText("跳过失败，请重试");
    }
  }, [threadId]);

  // When the research id changes, set the active tab to activities
  useEffect(() => {
    if (!hasReport) {
      setActiveTab("activities");
    }
  }, [hasReport, researchId]);

  return (
    <div className={cn("h-full w-full over-hide-box", className)}>
      <Card className={cn("relative h-full w-full pt-4", className)}>
        <div className="absolute right-4 flex h-9 items-center justify-center">
          {hasReport && !reportStreaming && (
            <>
              {/* <Tooltip title={t("generatePodcast")}>
                <Button
                  className="text-gray-400"
                  size="icon"
                  variant="ghost"
                  disabled={isReplay}
                  onClick={handleGeneratePodcast}
                >
                  <Headphones />
                </Button>
              </Tooltip> */}
              <Tooltip title={t("edit")}>
                <Button
                  className="text-gray-400"
                  size="icon"
                  variant="ghost"
                  disabled={isReplay}
                  onClick={handleEdit}
                >
                  {editing ? <Undo2 /> : <Pencil />}
                </Button>
              </Tooltip>
              <Tooltip title={t("copy")}>
                <Button
                  className="text-gray-400"
                  size="icon"
                  variant="ghost"
                  onClick={handleCopy}
                >
                  {copied ? <Check /> : <Copy />}
                </Button>
              </Tooltip>
              <DropdownMenu>
                <Tooltip title="下载报告">
                  <DropdownMenuTrigger asChild>
                    <Button
                      className="text-gray-400"
                      size="icon"
                      variant="ghost"
                    >
                      <Download />
                    </Button>
                  </DropdownMenuTrigger>
                </Tooltip>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleDownloadMarkdown}>
                    <FileText className="mr-2 h-4 w-4" />
                    <span>下载为 Markdown</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onShowDownloadDrawer}>
                    <FileType className="mr-2 h-4 w-4" />
                    <span>下载为 Word</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDownloadHTML}>
                    <FileCode className="mr-2 h-4 w-4" />
                    <span>下载为 HTML</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

            </>
          )}
          <Tooltip title={t("close")}>
            <Button
              className="text-gray-400"
              size="sm"
              variant="ghost"
              onClick={() => {
                closeResearch();
              }}
            >
              <X />
            </Button>
          </Tooltip>
        </div>
        <Tabs
          className="flex h-full w-full flex-col "
          value={activeTab}
          onValueChange={(value) => setActiveTab(value)}
        >
          <div className="flex w-full justify-center">
            <TabsList className="">
              <TabsTrigger
                className="px-8"
                value="report"
                disabled={!hasReport}
              >
                {t("report")}
              </TabsTrigger>
              <TabsTrigger className="px-8" value="activities">
                {t("activities")}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent
            className="h-full min-h-0 flex-grow px-8"
            value="report"
            forceMount
            hidden={activeTab !== "report"}
          >
            <ScrollContainer
              className="px-5pb-20 h-full"
              scrollShadowColor="var(--card)"
              autoScrollToBottom={!hasReport || reportStreaming}
            >
              {reportId && researchId && (
                <ResearchReportBlock
                  className="mt-4"
                  researchId={researchId}
                  messageId={reportId}
                  editing={editing}
                />
              )}
            </ScrollContainer>
          </TabsContent>
          <TabsContent
            className="h-full min-h-0 flex-grow px-4"
            value="activities"
            forceMount
            hidden={activeTab !== "activities"}
          >
            <ScrollContainer
              className="h-full report-box-con"
              scrollShadowColor="var(--card)"
              autoScrollToBottom={!hasReport || reportStreaming}
            >
              {researchId && (
                <ResearchActivitiesBlock
                  className="mt-4 timeline-ul"
                  researchId={researchId}
                />
              )}
            </ScrollContainer>
          </TabsContent>
        </Tabs>

        {/* 跳过当前步骤按钮 */}
        {showSkipButton && (
          <div className="absolute bottom-4 right-4 z-10">
            <Tooltip title="跳过执行">
              <Button
                size="lg"
                onClick={handleSkipExecution}
                className="bg-blue-500 text-white hover:bg-blue-600 shadow-lg rounded-full px-6 py-3 transform transition-all duration-200 hover:scale-105 active:scale-95 text-base font-medium"
              >
                <SkipForward className="h-5 w-5 mr-2" />
                {skipButtonText}
              </Button>
            </Tooltip>
          </div>
        )}
      </Card>
      <HtmlDownDialog
        ref={dialogRef}
        reportId={reportId}
        checkpointId={checkpointId}
        fileName={`research-report-${new Date().toISOString().slice(0, 10)}`}
      />
    </div>
  );
}

```

### 5.7 H（续）：前端设置与 RAG/MCP API

#### tutorial/web/src/core/api/rag.ts

修改内容：新增/覆盖：RAG 配置与资源 API。

```typescript
import type { Resource } from "../messages";

import type { KnowledgeBasePlatform } from "~/typings/knowledge-base";
import { resolveServiceURL } from "./resolve-service-url";

export interface KnowledgeBaseConfig {
  id?: string;
  user_id?: string;
  name: string;
  platform: KnowledgeBasePlatform;
  api_url: string;
  ext_config: Record<string, any>;
  retrieval_size: number;
  similarity: number;
  enabled?: boolean;
  is_enabled?: boolean;
}

export interface SaveKnowledgeBaseParams {
  id?: string;
  user_id?: string;
  name: string;
  platform: KnowledgeBasePlatform;
  api_url: string;
  ext_config: Record<string, any>;
  retrieval_size: number;
  similarity: number;
  is_enabled?: boolean;
}

export async function queryRAGResources(query: string) {
  const params = new URLSearchParams({ query });
  return fetch(resolveServiceURL(`rag/resources?${params.toString()}`), {
    method: "GET",
  })
    .then((res) => res.json())
    .then((res) => {
      return res.resources as Array<Resource>;
    })
    .catch(() => {

      return [];

    });
}

export async function saveKnowledgeBaseConfig(config: SaveKnowledgeBaseParams) {
  const res = await fetch(resolveServiceURL("config/rag/save_config"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });

  // 检查响应状态
  if (!res.ok) {
    // 尝试解析 JSON 错误响应
    const errorData = await res.json().catch(() => ({}));
    // 获取错误消息（优先级：message > error > statusText）
    const errorMessage = errorData.message || errorData.error || errorData.detail || res.statusText || "Failed to save knowledge base config";
    // 创建包含详细信息的错误对象
    const error = new Error(errorMessage) as Error & { status?: number; data?: any };
    error.status = res.status;
    error.data = errorData;
    throw error;
  }

  return res.json();
}

export async function updateKnowledgeBaseConfig(
  configId: string,
  config: Partial<KnowledgeBaseConfig>
) {
  return fetch(resolveServiceURL(`config/rag/${configId}`), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  })
    .then(async (res) => {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.message || res.statusText);
      }
      return res.json();
    })
    .catch((error) => {
      console.error("Failed to update knowledge base config:", error);
      throw error;
    });
}

export async function getKnowledgeBaseConfigs() {
  return fetch(resolveServiceURL("config/rag/get_config"), {
    method: "GET",
  })
    .then((res) => res.json())
    .catch((error) => {
      console.error("Failed to get knowledge base configs:", error);
      throw error;
    });
}

export async function deleteKnowledgeBaseConfig(configId: string) {
  return fetch(resolveServiceURL(`config/rag/${configId}`), {
    method: "DELETE",
  })
    .then(async (res) => {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.message || res.statusText);
      }
      return res.json();
    })
    .catch((error) => {
      console.error("Failed to delete knowledge base config:", error);
      throw error;
    });
}

// ============================================================
// 增量④ AIHUB 扩展：AIHUB 的凭据放在 ext_config 里，复用上面的通用 CRUD。
// 下面提供 AIHUB 专用的类型和便捷函数。
// ============================================================

/** AIHUB 平台的 ext_config 结构 */
export interface AihubExtConfig {
  username: string;
  password: string;
}

/** 保存 AIHUB 知识库的简化参数（不需要手动拼 ext_config） */
export interface SaveAihubParams {
  name: string;
  api_url: string;
  username: string;
  password: string;
  retrieval_size?: number;
  similarity?: number;
}

/**
 * 保存 AIHUB 知识库配置的便捷函数。
 * 内部把 username / password 包装进 ext_config，调用通用 saveKnowledgeBaseConfig。
 */
export async function saveAihubConfig(params: SaveAihubParams) {
  return saveKnowledgeBaseConfig({
    name: params.name,
    platform: "aihub",
    api_url: params.api_url,
    ext_config: {
      username: params.username,
      password: params.password,
    },
    retrieval_size: params.retrieval_size ?? 10,
    similarity: params.similarity ?? 0.6,
    is_enabled: true,
  });
}

export type TestConnectionResponse = {
  success: boolean;
  resource_count: number;
  message: string;
};

export async function testKnowledgeBaseConnection(params: {
  platform: KnowledgeBasePlatform;
  api_url: string;
  ext_config: Record<string, any>;
}) {
  const res = await fetch(resolveServiceURL("config/rag/test_connection"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const errorMessage =
      errorData.message || errorData.error || errorData.detail || res.statusText ||
      "Failed to test knowledge base connection";
    const error = new Error(errorMessage) as Error & { status?: number; data?: any };
    error.status = res.status;
    error.data = errorData;
    throw error;
  }

  return res.json();
}

```

#### tutorial/web/src/core/api/mcp.ts

修改内容：新增/覆盖：MCP metadata API。

```typescript
// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import type { SimpleMCPServerMetadata } from "../mcp";

import { resolveServiceURL } from "./resolve-service-url";

export async function queryMCPServerMetadata(config: SimpleMCPServerMetadata, signal?: AbortSignal) {
  const response = await fetch(resolveServiceURL("mcp/server/metadata"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
    signal,
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

```

#### tutorial/web/src/core/mcp/schema.ts

修改内容：新增/覆盖：MCP 连接配置 schema。

```typescript
// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { z } from "zod";

export const MCPConfigSchema = z.object({
  mcpServers: z.record(
    z.union(
      [
        z.object({
          command: z.string({
            message: "`command` must be a string",
          }),
          args: z
            .array(z.string(), {
              message: "`args` must be an array of strings",
            })
            .optional(),
          env: z
            .record(z.string(), {
              message: "`env` must be an object of key-value pairs",
            })
            .optional(),
        }),
        z.object({
          url: z
            .string({
              message:
                "`url` must be a valid URL starting with http:// or https://",
            })
            .refine(
              (value) => {
                try {
                  const url = new URL(value);
                  return url.protocol === "http:" || url.protocol === "https:";
                } catch {
                  return false;
                }
              },
              {
                message:
                  "`url` must be a valid URL starting with http:// or https://",
              },
            ),
          env: z
            .record(z.string(), {
              message: "`env` must be an object of key-value pairs",
            })
            .optional(),
          headers: z
            .record(z.string(), {
              message: "`headers` must be an object of key-value pairs",
            })
            .optional(),
          transport: z
            .enum(["sse", "streamable_http"], {
              message: "transport must be either sse or streamable_http"
            })
            .default("sse"),
        }),
      ],
      {
        message: "Invalid server type",
      },
    ),
  ),
});

```

#### tutorial/web/src/core/store/settings-store.ts

修改内容：完整覆盖：知识库、MCP、可观测设置状态。

```typescript
// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { create } from "zustand";

import type { MCPServerMetadata, SimpleMCPServerMetadata } from "../mcp";
import type { KnowledgeBaseConfig } from "~/typings/knowledge-base";

const SETTINGS_KEY = "deerflow.settings";

const DEFAULT_SETTINGS: SettingsState = {
  general: {
    autoAcceptedPlan: true,  // ch08 默认跳过 HITL 计划确认；ch09+ 讲 HITL 时可改回 false 或用 UI 开关
    enableDeepThinking: false,
    enableWebSearch: false,
    enableBackgroundInvestigation: false,
    maxPlanIterations: 1,
    maxStepNum: 3,
    maxSearchResults: 3,
    reportStyle: "academic",
    retriever_limit: 3,
    retriever_similarity: 0.4,
    max_step_retry: 1,
    min_step_score: 0.8,
    enableRAG: true,
    autoSelectKB: true,
  },
  mcp: {

    servers: [],

  },

  knowledgeBases: [],

};

export type SettingsState = {
  general: {
    autoAcceptedPlan: boolean;
    enableDeepThinking: boolean;
    enableWebSearch: boolean;
    enableBackgroundInvestigation: boolean;
    maxPlanIterations: number;
    maxStepNum: number;
    maxSearchResults: number;
    reportStyle: "academic" | "popular_science" | "news" | "social_media";
    retriever_similarity?: number;
    retriever_limit?: number;
    max_step_retry?: number;
    min_step_score?: number;
    enableRAG?: boolean;
    autoSelectKB?: boolean;
    userID?: string;
  };
  mcp: {

    servers: MCPServerMetadata[];

  };

  knowledgeBases: KnowledgeBaseConfig[];

};

export const useSettingsStore = create<SettingsState>(() => ({
  ...DEFAULT_SETTINGS,
}));

export const useSettings = (key: keyof SettingsState) => {
  return useSettingsStore((state) => state[key]);
};

export const changeSettings = (settings: SettingsState) => {
  useSettingsStore.setState(settings);
};

export const loadSettings = () => {
  if (typeof window === "undefined") {
    return;
  }
  const json = localStorage.getItem(SETTINGS_KEY);
  if (json) {
    const settings = JSON.parse(json);
    for (const key in DEFAULT_SETTINGS.general) {
      if (!(key in settings.general)) {
        settings.general[key as keyof SettingsState["general"]] =
          DEFAULT_SETTINGS.general[key as keyof SettingsState["general"]];
      }
    }

    try {
      useSettingsStore.setState(settings);
    } catch (error) {
      console.error(error);
    }
  }
};

export const saveSettings = () => {
  const latestSettings = useSettingsStore.getState();
  const json = JSON.stringify(latestSettings);
  localStorage.setItem(SETTINGS_KEY, json);
};

export const getChatStreamSettings = () => {
  let mcpSettings:
    | {
      servers: Record<
        string,
        MCPServerMetadata & {

          enabled_tools: string[];


          add_to_agents: string[];

        }
      >;
    }
    | undefined = undefined;
  const { mcp, general, knowledgeBases } = useSettingsStore.getState();
  const mcpServers = mcp.servers.filter((server) => server.enabled);
  if (mcpServers.length > 0) {
    mcpSettings = {
      servers: mcpServers.reduce((acc, cur) => {
        const { transport, env, headers } = cur;
        let server: SimpleMCPServerMetadata;
        if (transport === "stdio") {
          server = {
            name: cur.name,
            transport,
            env,
            command: cur.command,
            args: cur.args,
          };
        } else {
          server = {
            name: cur.name,
            transport,
            headers,
            url: cur.url,
          };
        }
        return {
          ...acc,
          [cur.name]: {
            ...server,
            enabled_tools: cur.tools.map((tool) => tool.name),
            add_to_agents: ["researcher"],
          },
        };
      }, {}),
    };
  }

  // RAG 平台配置：把用户启用的知识库塞进 chat 请求 rag_configs。
  // 后端 rag/builder.py:build_retriever_by_configs 按 platform 分派 provider
  // （目前 aihub 走真连接，其它走 memory 分支）。字段结构对齐后端解析：
  //   platform / rag_platform_id / api_url / retrieval_size / similarity / ext_config
  const enabledKBs = general.enableRAG

    ? (knowledgeBases ?? []).filter((kb) => kb.enabled)


    : [];

  const rag_configs = enabledKBs.map((kb) => ({
    rag_platform_id: kb.id ?? "",
    platform: kb.platform,
    api_url: kb.api_url,
    retrieval_size: kb.retrieval_size,
    similarity: kb.similarity,
    ext_config: kb.ext_config ?? {},
  }));

  return {
    ...general,
    mcpSettings,
    rag_configs,
  };
};

export function setReportStyle(
  value: "academic" | "popular_science" | "news" | "social_media",
) {
  useSettingsStore.setState((state) => ({
    general: {
      ...state.general,
      reportStyle: value,
    },
  }));
  saveSettings();
}

export function setEnableDeepThinking(value: boolean) {
  useSettingsStore.setState((state) => ({
    general: {
      ...state.general,
      enableDeepThinking: value,
    },
  }));
  saveSettings();
}

export function setEnableBackgroundInvestigation(value: boolean) {
  useSettingsStore.setState((state) => ({
    general: {
      ...state.general,
      enableBackgroundInvestigation: value,
    },
  }));
  saveSettings();
}
// 设置是否开启rag
export function setEnableRAG(value: boolean) {
  useSettingsStore.setState((state) => ({
    general: {
      ...state.general,
      enableRAG: value,
    },
  }));
  saveSettings();
}
export function setEnableWebSearch(value: boolean) {
  useSettingsStore.setState((state) => ({
    general: {
      ...state.general,
      enableWebSearch: value,
    },
  }));
  saveSettings();
}
loadSettings();

```

#### tutorial/web/src/app/settings/dialogs/add-aihub-dialog.tsx

修改内容：新增文件：AIHub 配置录入与连接测试。

```tsx
// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT
//
// 第 10 章增量④：AIHUB 知识库添加对话框（老师完整版）。
// 核心教学点：ext_config 里传 username/password 给后端。

import { message } from "antd";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { PasswordInput } from "~/components/ui/password-input";
import { testKnowledgeBaseConnection } from "~/core/api/rag";
import type {
  KnowledgeBaseConfig,
  KnowledgeBasePlatform,
} from "~/typings/knowledge-base";

interface AddKnowledgeBaseDialogProps {
  onAdd: (config: Omit<KnowledgeBaseConfig, "id" | "status">) => void;
  onEdit?: (config: KnowledgeBaseConfig) => void;
  editConfig?: KnowledgeBaseConfig | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  children?: React.ReactNode;
}

export function AddAihubDialog({
  onAdd,
  onEdit,
  editConfig,
  open: controlledOpen,
  onOpenChange,
  onClose,
  children,
}: AddKnowledgeBaseDialogProps) {
  const t = useTranslations("settings.rag");
  const isEdit = !!editConfig;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const [platform, setPlatform] = useState<KnowledgeBasePlatform>("aihub");
  const [name, setName] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [testing, setTesting] = useState(false);
  const [retrievalSize, setRetrievalSize] = useState<number>(10);
  const [similarity, setSimilarity] = useState<number>(0.6);
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const [errors, setErrors] = useState<{
    name?: string;
    apiUrl?: string;
    username?: string;
    password?: string;
  }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setPlatform("aihub");
    setName("");
    setApiUrl("");
    setUsername("");
    setPassword("");
    setRetrievalSize(10);
    setSimilarity(0.6);
    setErrors({});
    setSubmitError(null);

  }, []);


  const initializeForm = useCallback(
    (config: KnowledgeBaseConfig | null) => {
      if (config) {
        setPlatform("aihub");
        setName(config.name);
        setApiUrl(config.api_url);
        setUsername(config.ext_config["username"] || "");
        setPassword(config.ext_config["password"] || "");
        setRetrievalSize(config.retrieval_size);
        setSimilarity(config.similarity);
        setErrors({});
      } else {
        resetForm();
      }
    },
    [resetForm],
  );

  const handleTestConnection = async () => {
    try {
      setTesting(true);

      const res = await testKnowledgeBaseConnection({
        platform: "aihub",
        api_url: apiUrl,
        ext_config: { username, password },
      });

      if (res?.success === true) {
        messageApi.open({
          type: "success",
          content: t("testSuccess", { count: res.resource_count ?? 0 }),
        });
      } else {
        messageApi.open({
          type: "error",
          content: res?.message
            ? t("testFailedWithReason", { reason: res.message })
            : t("testFailed"),
        });
      }
    } catch (e: any) {
      messageApi.open({
        type: "error",
        content: t("testFailed"),
      });
    } finally {
      setTesting(false);
    }
  };

  const closeDialog = useCallback(() => {
    if (controlledOpen === undefined) {
      setInternalOpen(false);
    }
    onOpenChange?.(false);
    resetForm();
  }, [controlledOpen, onOpenChange, resetForm]);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        resetForm();
        onClose?.();
      }
      if (controlledOpen === undefined) {
        setInternalOpen(newOpen);
      }
      onOpenChange?.(newOpen);
    },
    [resetForm, onOpenChange, controlledOpen, onClose],
  );

  useEffect(() => {
    if (editConfig) {
      initializeForm(editConfig);
      if (controlledOpen === undefined) {
        setInternalOpen(true);
      }
    }
  }, [editConfig, controlledOpen, initializeForm]);

  const validateForm = useCallback(() => {
    const newErrors: {
      name?: string;
      apiUrl?: string;
      username?: string;
      password?: string;
    } = {};

    if (!name.trim()) {
      newErrors.name = t("nameRequired");
    }

    if (!apiUrl.trim()) {
      newErrors.apiUrl = t("apiUrlRequired");
    } else {
      try {
        new URL(apiUrl);
      } catch {
        newErrors.apiUrl = t("apiUrlInvalid");
      }
    }

    if (!username.trim()) {
      newErrors.username = t("usernameRequired");
    }

    if (!password.trim()) {
      newErrors.password = t("passwordRequired");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, apiUrl, username, password, t]);

  const handleAdd = useCallback(async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setSubmitError(null);

    try {
      // AIHUB 的核心：ext_config 里放 username/password
      const configData = {
        user_id: "default_user",
        platform: platform,
        name: name.trim(),
        api_url: apiUrl.trim(),
        ext_config: {
          username: username.trim(),
          password: password.trim(),
        },
        retrieval_size: retrievalSize,
        similarity: similarity,
        enabled: true,
      };

      if (isEdit && editConfig && onEdit) {
        await onEdit({
          ...editConfig,
          ...configData,
        });
      } else {
        await onAdd(configData);
      }

      messageApi.open({
        type: "success",
        content: "添加知识库成功",
      });
      closeDialog();
    } catch (error) {
      console.error("Failed to save knowledge base:", error);
      messageApi.open({
        type: "error",
        content: "保存失败",
      });
      setSubmitError("保存知识库失败");
    } finally {
      setLoading(false);
    }
  }, [
    platform,
    name,
    apiUrl,
    username,
    password,
    retrievalSize,
    similarity,
    onAdd,
    onEdit,
    editConfig,
    isEdit,
    validateForm,
    resetForm,
    closeDialog,
    t,
  ]);

  return (
    <>
      {contextHolder}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <div className="flex items-center">
              <img
                src="/images/aihub-logo.png"
                alt=""
                className="mr-2 h-5 w-5"
              />
              <DialogTitle>
                {isEdit ? t("editKnowledgeBase") : t("addKnowledgeBase")}
              </DialogTitle>
            </div>
            <DialogDescription>
              {isEdit
                ? t("editKnowledgeBaseDescription")
                : t("addKnowledgeBaseDescription")}
            </DialogDescription>
          </DialogHeader>

          {submitError && (
            <div className="text-destructive bg-destructive/10 rounded-md p-3 text-sm">
              {submitError}
            </div>
          )}

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">{t("name")}</Label>
              <Input
                id="name"
                placeholder={t("namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {errors.name && (
                <p className="text-destructive text-sm">{errors.name}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="api_url">{t("apiUrl")}</Label>
              <Input
                id="api_url"
                placeholder="https://api.aihub.com"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
              />
              {errors.apiUrl && (
                <p className="text-destructive text-sm">{errors.apiUrl}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="username">{t("username")}</Label>
              <Input
                id="username"
                placeholder={t("usernamePlaceholder")}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              {errors.username && (
                <p className="text-destructive text-sm">{errors.username}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="password">{t("password")}</Label>

              <PasswordInput
                id="password"
                placeholder={t("passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              {errors.password && (
                <p className="text-destructive text-sm">{errors.password}</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="retrieval_size">{t("retrievalSize")}</Label>
              <Input
                id="retrieval_size"
                type="number"
                min={1}
                max={20}
                value={retrievalSize}
                onChange={(e) =>
                  setRetrievalSize(parseInt(e.target.value) || 10)
                }
              />
              <p className="text-muted-foreground text-sm">
                {t("retrievalSizeDescription")}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="similarity">{t("similarity")}</Label>
              <Input
                id="similarity"
                type="number"
                min={0.1}
                max={1.0}
                step={0.1}
                value={similarity}
                onChange={(e) =>
                  setSimilarity(parseFloat(e.target.value) || 0.6)
                }
              />
              <p className="text-muted-foreground text-sm">
                {t("similarityDescription")}
              </p>
            </div>
          </div>

          <DialogFooter className="flex items-center">
            <Button
              variant="secondary"
              type="button"
              disabled={
                !apiUrl.trim() ||
                !username.trim() ||
                !password.trim() ||
                testing
              }
              onClick={handleTestConnection}
            >
              {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              测试连接
            </Button>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={closeDialog}>
                {t("cancel")}
              </Button>

              <Button
                className="w-24"
                type="submit"
                disabled={
                  loading ||
                  !name.trim() ||
                  !apiUrl.trim() ||
                  !username.trim() ||
                  !password.trim()
                }
                onClick={handleAdd}
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEdit ? t("save") : t("add")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

```

#### tutorial/web/src/app/settings/tabs/knowledge-tab.tsx

修改内容：完整覆盖：知识库配置、选择和刷新。

```tsx
// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT
//
// 第 10 章增量④：知识库配置面板（老师完整版）。
// 含 Dify/RAGFlow/ES/AIHUB 四平台入口，AIHUB 专用的 handleAddAihubKB
// 展示 ext_config 里传 username/password 的模式。

import { zodResolver } from "@hookform/resolvers/zod";
import { Database, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  getKnowledgeBaseConfigs,
  saveKnowledgeBaseConfig,
  updateKnowledgeBaseConfig,
} from "~/core/api/rag";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import {
  Tooltip,
} from "~/components/ui/tooltip";
import type { SettingsState } from "~/core/store";
import type { KnowledgeBaseConfig, KnowledgeBasePlatform } from "./rag";

import { AddAihubDialog } from "../dialogs/add-aihub-dialog";
import { AddCommonRAGDialog } from "../dialogs/add-common-dialog";
import { KnowledgeBaseList } from "./rag";
import type { Tab } from "./types";

const knowledgeFormSchema = z.object({
  retriever_similarity: z
    .number({
      required_error: "检索相似度不能为空",
      invalid_type_error: "检索相似度不能为空",
    })
    .min(0, { message: "检索相似度不能小于0" })
    .max(1, { message: "检索相似度不能大于1" }),
  retriever_limit: z
    .number({
      required_error: "检索次数不能为空",
      invalid_type_error: "检索次数不能为空",
    })
    .min(1, { message: "检索次数限制不能小于1" })
    .max(10, { message: "检索次数限制不能大于10" }),
  autoSelectKB: z.boolean(),
});

export const KnowledgeTab: Tab = ({
  settings,
  onChange,
  onValidationChange,
}: {
  settings: SettingsState;
  onChange: (changes: Partial<SettingsState>) => void;
  onValidationChange?: (isValid: boolean) => void;
}) => {
  const t = useTranslations("settings.rag");

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseConfig[]>(


    settings.knowledgeBases || [],

  );
  const [loadingKnowledgeBases, setLoadingKnowledgeBases] = useState(false);
  const [knowledgeBasesLoaded, setKnowledgeBasesLoaded] = useState(false);
  const [updatingKnowledgeBase, setUpdatingKnowledgeBase] = useState<
    string | null
  >(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialog, setAddDialog] = useState(false);
  const [selectedPlatform, setSelectedPlatform] =
    useState<KnowledgeBasePlatform | null>(null);

  const prevKnowledgeBasesRef = useRef<KnowledgeBaseConfig[]>([]);

  const mountedRef = useRef(true);

  const knowledgeSettings = useMemo(
    () => ({
      retriever_similarity: settings.general.retriever_similarity
        ? Number(settings.general.retriever_similarity)
        : 0.4,
      retriever_limit: settings.general.retriever_limit
        ? Number(settings.general.retriever_limit)
        : 3,
      autoSelectKB: settings.general.autoSelectKB || false,
    }),
    [settings],
  );

  const form = useForm<z.infer<typeof knowledgeFormSchema>>({
    resolver: zodResolver(knowledgeFormSchema, undefined, undefined),
    defaultValues: knowledgeSettings,
    mode: "all",
    reValidateMode: "onBlur",
  });

  const currentSettings = form.watch();
  useEffect(() => {
    const hasChanges = Object.keys(currentSettings).some((key) => {
      const currentValue = currentSettings[key as keyof typeof currentSettings];
      const settingsValue =
        settings.general[key as keyof SettingsState["general"]];
      return Number(currentValue) !== Number(settingsValue);
    });

    if (hasChanges) {
      onChange({
        general: {
          ...settings.general,
          ...currentSettings,
        },
      });
    }
  }, [currentSettings, onChange, settings]);

  const prevIsValidRef = useRef<boolean | null>(null);
  useEffect(() => {
    const isValid = form.formState.isValid;

    if (prevIsValidRef.current !== isValid) {
      prevIsValidRef.current = isValid;
      onValidationChange?.(isValid);
    }
  }, [form.formState.isValid, onValidationChange]);

  const loadKnowledgeBasesFromDB = useCallback(
    async (force = false) => {
      if (!force && knowledgeBasesLoaded) {
        return;
      }
      console.log("loadKnowledgeBasesFromDB");

      if (!force && !mountedRef.current) return;

      setLoadingKnowledgeBases(true);
      try {
        const configs = await getKnowledgeBaseConfigs();


        const formattedConfigs: KnowledgeBaseConfig[] = configs.map(

          (config: any) => ({
            id: String(config.id),
            name: config.name,
            platform: config.platform,
            api_url: config.api_url,
            ext_config: config.ext_config || {},
            retrieval_size: config.retrieval_size,
            similarity: config.similarity,
            enabled: config.is_selected || false,
          }),
        );
        setKnowledgeBases(formattedConfigs);
        setKnowledgeBasesLoaded(true);
        onChange({ ...settings, knowledgeBases: formattedConfigs });
      } catch (error) {
        console.error("Failed to load knowledge bases from database:", error);
        if (mountedRef.current) {
          setKnowledgeBasesLoaded(true);
        }
      } finally {
        setLoadingKnowledgeBases(false);
      }
    },
    [knowledgeBasesLoaded, settings, onChange],
  );

  useEffect(() => {
    loadKnowledgeBasesFromDB();
    return () => {
      mountedRef.current = false;
    };

  }, []);


  useEffect(() => {
    if (
      JSON.stringify(prevKnowledgeBasesRef.current) !==
      JSON.stringify(settings.knowledgeBases)
    ) {

      setKnowledgeBases(settings.knowledgeBases || []);


      prevKnowledgeBasesRef.current = settings.knowledgeBases || [];

    }
  }, [settings.knowledgeBases]);

  const handleAddCommonKnowledgeBase = useCallback(
    async (config: Omit<KnowledgeBaseConfig, "id">) => {
      try {
        const result = await saveKnowledgeBaseConfig({
          user_id: settings.general.userID ?? "default_user",
          name: config.name,
          platform: config.platform,
          api_url: config.api_url,
          ext_config: config.ext_config,
          retrieval_size: config.retrieval_size,
          similarity: config.similarity,
          is_enabled: config.enabled,
        });

        const newConfig: KnowledgeBaseConfig = {
          ...config,
          id: String(result.id),
        };

        const newKnowledgeBases = [...knowledgeBases, newConfig];
        setKnowledgeBases(newKnowledgeBases);
        onChange({ ...settings, knowledgeBases: newKnowledgeBases });
        setAddDialogOpen(false);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "保存知识库失败";
        throw new Error(message);
      }
    },
    [knowledgeBases, onChange, settings],
  );

  // AIHUB 专用保存：与 handleAddCommonKnowledgeBase 结构一致，
  // 区别在于 config.ext_config 已由 AddAihubDialog 填好 { username, password }
  const handleAddAihubKB = useCallback(
    async (config: Omit<KnowledgeBaseConfig, "id">) => {
      try {
        const result = await saveKnowledgeBaseConfig({
          user_id: settings.general.userID ?? "default_user",
          name: config.name,
          platform: config.platform,
          api_url: config.api_url,
          ext_config: config.ext_config,
          retrieval_size: config.retrieval_size,
          similarity: config.similarity,
          is_enabled: config.enabled,
        });

        const newConfig: KnowledgeBaseConfig = {
          ...config,
          id: String(result.id),
        };

        const newKnowledgeBases = [...knowledgeBases, newConfig];
        setKnowledgeBases(newKnowledgeBases);
        onChange({ ...settings, knowledgeBases: newKnowledgeBases });
        setAddDialogOpen(false);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "保存知识库失败，请重试";
        throw new Error(errorMessage);
      }
    },
    [knowledgeBases, onChange, settings],
  );

  const handleDeleteKnowledgeBase = useCallback(
    (id: string) => {
      const newKnowledgeBases = knowledgeBases.filter((kb) => kb.id !== id);
      setKnowledgeBases(newKnowledgeBases);
      onChange({ ...settings, knowledgeBases: newKnowledgeBases });
    },
    [knowledgeBases, onChange, settings],
  );

  const handleToggleKnowledgeBase = useCallback(
    async (id: string, enabled: boolean) => {
      const originalKnowledgeBases = knowledgeBases;
      const newKnowledgeBases = knowledgeBases.map((kb) =>
        kb.id === id ? { ...kb, enabled } : kb,
      );
      setKnowledgeBases(newKnowledgeBases);
      onChange({ ...settings, knowledgeBases: newKnowledgeBases });

      setUpdatingKnowledgeBase(id);

      try {
        await updateKnowledgeBaseConfig(id, { id: id, is_enabled: enabled });
      } catch (error) {
        console.error("Failed to update knowledge base status:", error);

        if (mountedRef.current) {
          setKnowledgeBases(originalKnowledgeBases);
          onChange({ ...settings, knowledgeBases: originalKnowledgeBases });
        }

        alert("更新知识库状态失败，请重试");
      } finally {
        setUpdatingKnowledgeBase(null);
      }
    },
    [knowledgeBases, onChange, settings],
  );

  const handleRefreshKnowledgeBase = useCallback((id: string) => {
    console.log("Refreshing knowledge base:", id);

  }, []);


  const handleEditKnowledgeBase = useCallback(
    (config: KnowledgeBaseConfig) => {
      const newKnowledgeBases = knowledgeBases.map((kb) =>
        kb.id === config.id ? config : kb,
      );
      setKnowledgeBases(newKnowledgeBases);
      onChange({ ...settings, knowledgeBases: newKnowledgeBases });
    },
    [knowledgeBases, onChange, settings],
  );

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-lg font-medium">{t("title")}</h1>
      </header>

      <main className="flex flex-col gap-8">
        <section>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-medium">{t("knowledgeBases")}</h2>
            </div>
            <div className="flex items-center gap-2">
              {loadingKnowledgeBases && (
                <span className="text-muted-foreground text-sm">加载中...</span>
              )}
              {updatingKnowledgeBase && (
                <span className="text-muted-foreground text-sm">更新中...</span>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={loadingKnowledgeBases || !!updatingKnowledgeBase}
                  >
                    {t("addKnowledgeBase")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onSelect={() => {
                      setSelectedPlatform("dify");
                      setAddDialogOpen(true);
                      setAddDialog(true);
                    }}
                  >
                    <img
                      src="/images/dify-color.svg"
                      alt=""
                      className="mr-2 h-4 w-4"
                    />
                    Dify
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setSelectedPlatform("ragflow");
                      setAddDialogOpen(true);
                      setAddDialog(true);
                    }}
                  >
                    <img
                      src="/images/ragflow-logo.svg"
                      alt=""
                      className="mr-2 h-4 w-4"
                    />
                    RAGFlow
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setSelectedPlatform("aihub");
                      setAddDialogOpen(true);
                      setAddDialog(true);
                    }}
                  >
                    <img
                      src="/images/aihub-logo.png"
                      alt=""
                      className="mr-2 h-4 w-4"
                    />
                    AIHUB
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setSelectedPlatform("es");
                      setAddDialogOpen(true);
                      setAddDialog(true);
                    }}
                  >
                    <img
                      src="/images/es-logo.ico"
                      alt=""
                      className="mr-2 h-4 w-4"
                    />
                    Elasticsearch
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadKnowledgeBasesFromDB(true)}
                disabled={loadingKnowledgeBases || !!updatingKnowledgeBase}
              >
                <RefreshCw className="mr-1 h-4 w-4" />
                刷新
              </Button>

              <AddCommonRAGDialog
                open={
                  addDialogOpen &&
                  (selectedPlatform === "dify" ||
                    selectedPlatform === "ragflow" ||
                    selectedPlatform === "es")
                }
                onOpenChange={(open) => {
                  setAddDialogOpen(open);
                  if (!open) {
                    setSelectedPlatform(null);
                  }
                }}
                onAdd={handleAddCommonKnowledgeBase}
                editConfig={
                  (selectedPlatform === "dify" ||
                    selectedPlatform === "ragflow" ||
                    selectedPlatform === "es") &&
                  addDialog
                    ? null
                    : {
                        id: "",
                        user_id: "",
                        name: "",
                        platform: selectedPlatform as "dify" | "ragflow" | "es",
                        api_url: "",
                        ext_config: {},
                        retrieval_size: 10,
                        similarity: 0.6,
                        enabled: false,
                      }
                }
                initialPlatform={selectedPlatform || "dify"}
              />
              <AddAihubDialog
                open={addDialogOpen && selectedPlatform === "aihub"}
                onOpenChange={(open) => {
                  setAddDialogOpen(open);
                  if (!open) {
                    setSelectedPlatform(null);
                  }
                }}
                onAdd={handleAddAihubKB}
                editConfig={
                  selectedPlatform === "aihub" && addDialog
                    ? null
                    : {
                        id: "",
                        user_id: "",
                        name: "",
                        platform: selectedPlatform as "aihub",
                        api_url: "",
                        ext_config: {},
                        retrieval_size: 10,
                        similarity: 0.6,
                        enabled: false,
                      }
                }
              />
            </div>
          </div>

          <KnowledgeBaseList
            knowledgeBases={knowledgeBases}
            onDelete={handleDeleteKnowledgeBase}
            onToggle={handleToggleKnowledgeBase}
            onRefresh={handleRefreshKnowledgeBase}
            onEdit={handleEditKnowledgeBase}
          />
        </section>

      </main>
    </div>
  );
};
KnowledgeTab.displayName = "知识库配置";
KnowledgeTab.icon = Database;

```

#### tutorial/web/src/app/settings/tabs/observability-tab.tsx

修改内容：新增文件：只展示当前后端真正支持的观测设置。

```tsx
// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT
//
// 第 10 章新增：可观测性设置面板。
// 学生学到 LangSmith trace 配置的前端呈现方式。
// 注意：真正的 tracing 是后端 langchain 自动读 LANGCHAIN_* 环境变量，
// 这个页面只是"看/记住 key 的开关状态"，不做实际写文件。

import { Activity } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import type { SettingsState } from "~/core/store";
import type { Tab } from "./types";

// 表单验证
const observabilityFormSchema = z.object({
    langsmith_enabled: z.boolean(),
    langsmith_api_key: z.string().optional(),
    langsmith_project: z.string().optional(),
});

export const ObservabilityTab: Tab = ({
    settings,
    onChange,
    onValidationChange,
}: {
    settings: SettingsState;
    onChange: (changes: Partial<SettingsState>) => void;
    onValidationChange?: (isValid: boolean) => void;
}) => {
    const observabilitySettings = useMemo(() => ({
        langsmith_enabled: Boolean(settings.general?.langsmith_enabled ?? false),
        langsmith_api_key: String(settings.general?.langsmith_api_key ?? ""),
        langsmith_project: String(settings.general?.langsmith_project ?? "deepResearch"),
    }), [settings]);

    const form = useForm<z.infer<typeof observabilityFormSchema>>({
        resolver: zodResolver(observabilityFormSchema, undefined, undefined),
        defaultValues: observabilitySettings,
        mode: "all",
        reValidateMode: "onBlur",
    });

    // 监听表单值变化并写回全局 settings
    const currentSettings = form.watch();
    useEffect(() => {
        const hasChanges = Object.keys(currentSettings).some(key => {
            const currentValue = currentSettings[key as keyof typeof currentSettings];
            const settingsValue = (settings.general as any)?.[key];
            return currentValue !== settingsValue;
        });

        if (hasChanges) {
            onChange({
                general: {
                    ...settings.general,
                    ...currentSettings,
                } as any,
            });
        }
    }, [currentSettings, onChange, settings]);

    // 监听表单验证状态
    const prevIsValidRef = useRef<boolean | null>(null);
    useEffect(() => {
        const isValid = form.formState.isValid;
        if (prevIsValidRef.current !== isValid) {
            prevIsValidRef.current = isValid;
            onValidationChange?.(isValid);
        }
    }, [form.formState.isValid, onValidationChange]);

    return (
        <div className="flex flex-col gap-4">
            <header>
                <h1 className="text-lg font-medium">可观测性设置</h1>
                <p className="text-muted-foreground text-sm mt-1">
                    配置 LangSmith trace 收集和节点耗时监控。改动会立即生效。
                </p>
            </header>
            <main>
                <Form {...form}>
                    <form className="space-y-8">
                        <FormField
                            control={form.control}
                            name="langsmith_enabled"
                            render={({ field }) => (
                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                    <div className="space-y-0.5">
                                        <FormLabel className="text-base">启用 LangSmith Tracing</FormLabel>
                                        <FormDescription>
                                            开启后，每个节点的输入/输出/耗时会自动上报到 LangSmith Dashboard
                                        </FormDescription>
                                    </div>
                                    <FormControl>
                                        <Switch
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="langsmith_api_key"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>API Key</FormLabel>
                                    <FormControl>
                                        <Input
                                            className="w-96"
                                            type="password"
                                            placeholder="lsv2_..."
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        从 https://smith.langchain.com/ 的 API Keys 页面复制
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="langsmith_project"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>项目名</FormLabel>
                                    <FormControl>
                                        <Input
                                            className="w-96"
                                            placeholder="deepResearch"
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormDescription>
                                        LangSmith Dashboard 里的项目分组名，同 LANGCHAIN_PROJECT 环境变量
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </form>
                </Form>
            </main>
        </div>
    );
};

ObservabilityTab.displayName = "Observability";
ObservabilityTab.icon = Activity;
ObservabilityTab.label = "可观测性";

```

### 5.8 I：依赖、配置与契约测试

#### code/pyproject.toml

修改内容：完整覆盖后执行 uv sync；不要手写 uv.lock。

```toml
[project]
name = "mini-deepresearch-ch10"
version = "0.10.0"
description = "第10章：研究过程增强（可观测健壮性 + MCP 工具 + RAG 检索）"
requires-python = ">=3.12"
dependencies = [
    "langgraph>=0.3.5",
    "langchain-openai>=0.3.0",
    "langchain-core>=0.3.0",
    "langchain-experimental>=0.3.0",  # 第3章新增：PythonREPL
    "ddgs>=9.0.0",                    # duckduckgo-search 已改名 ddgs
    "requests>=2.31.0",               # 第3章新增：JinaClient 爬虫
    "jinja2>=3.1.0",
    "python-dotenv>=1.0.0",
    "pydantic>=2.0.0",
    "pyyaml>=6.0",
    "json-repair>=0.7.0",             # 第2章：修复 LLM 输出的脏 JSON
    "fastapi>=0.110.0",               # 第8章新增：HTTP 服务
    "uvicorn>=0.27.0",                # 第8章新增：ASGI 服务器
    "sqlalchemy>=2.0.0",              # 第8章新增：业务表持久化
    "psycopg[binary]>=3.2.9",                # 第8章起：PG 驱动（psycopg3，免编译）
    "psycopg-pool>=3.2",                     # 异步连接池（checkpointer）
    "langgraph-checkpoint-postgres>=2.0.21", # checkpointer 持久化
]

# 可选增强（默认不装，主流程用 ddgs + Jina markdown 已可跑）：
#   uv run --extra tavily main.py        # 启用 Tavily 搜索引擎
#   uv run --extra readability main.py   # 启用爬虫 Readability 增强路径
#   uv run --extra mcp server.py         # 启用 MCP 工具加载（本章 MCP 增量）
[project.optional-dependencies]
tavily = ["tavily-python>=0.5.0"]
readability = ["markdownify>=0.13.0", "readabilipy>=0.3.0"]
mcp = ["langchain-mcp-adapters>=0.1.0"]  # 本章 MCP 增量：动态工具加载
aihub = ["ddddocr>=1.5.0"]  # AIHUB 验证码 OCR（实战/集成测试需要）

[dependency-groups]
dev = [
    "pytest>=9.1.1",
]

# uv run main.py 时：uv 自动创建 .venv、装依赖、运行脚本
# 不需要 [build-system]——本教程把每章 code/ 当作脚本集合，不做包构建

```

#### code/conf.yaml

修改内容：完整覆盖：增加 rerank 配置。

```yaml
# LLM 配置（与 .env 等价，环境变量优先级更高）
# 第1章只用 BASIC_MODEL；后续章节会加 REASONING_MODEL / EVALUATE_MODEL
BASIC_MODEL:
  base_url: http://192.168.9.204:8104/v1
  model: Qwen3-32B-FP8
  api_key: "your-api-key"
  token_limit: 32768        # 第7章 ContextManager 需要
  max_retries: 3            # 限流自动重试次数
  # verify_ssl: false       # 自签名证书时取消注释

# ===== Rerank 重排模型（AIHUB 知识库增强检索用）=====
RERANK_MODEL:
  type: "emb"     # 本地实战配置（勿提交）：emb 格式 /api/emb/rerank；教学默认 dmx
  base_url: "http://192.168.9.210:9500/api/emb"  # 本地 rerank 服务（勿提交）
  model: ""       # dmx 用；emb 可空
  api_key: ""     # dmx 用；emb 可空
  top_n: 6

# —— 第3章新增：以下能力通过 .env 环境变量配置（这里仅说明，不生效）——
# SEARCH_API              = duckduckgo(默认,免key) | tavily(需TAVILY_API_KEY) | none(禁用搜索)
# TAVILY_API_KEY          = Tavily 搜索 key（SEARCH_API=tavily 时必填）
# TAVILY_INCLUDE_DOMAINS  = Tavily 域名白名单，逗号分隔（如 wikipedia.org,arxiv.org）
# TAVILY_EXCLUDE_DOMAINS  = Tavily 域名黑名单，逗号分隔
# SEARCH_MIN_SCORE        = 搜索后处理最低相关度阈值（默认 0=不过滤）
# SEARCH_MAX_CONTENT_LEN  = 搜索后处理单页最大字符数（默认 4000）
# ENABLE_PYTHON_REPL      = true/false，是否允许 coder 执行 Python 代码（默认 false=安全）
# JINA_API_KEY            = Jina Reader key（爬虫 crawl_tool 用，免 key 有速率限制）

```

#### code/.env.example

修改内容：完整覆盖模板；只复制变量名，不把真实凭据写进讲义或提交。

```dotenv
# ===== LLM 配置（OpenAI 兼容格式）=====
# 环境变量会覆盖 conf.yaml 里的同名字段（BASIC_MODEL__<key> 格式）
BASIC_MODEL__base_url=http://your-llm-host:port/v1
BASIC_MODEL__model=Qwen3-32B-FP8
BASIC_MODEL__api_key=YOUR_API_KEY
# token 上限：第7章 ContextManager 需要；不填则上下文管理失效
BASIC_MODEL__token_limit=32768

# ===== 搜索引擎 =====
# duckduckgo（免 key，默认）/ none（禁用搜索，researcher 降级用 LLM 兜底）
SEARCH_API=duckduckgo

# ===== 日志 =====
DEBUG=True
ENABLE_PYTHON_REPL=true

# ===== 本章 MCP 增量：动态工具加载 =====
# 安全开关：默认关闭，避免任意命令执行风险；启用后 /api/chat/stream 才接受 mcp_settings
ENABLE_MCP_SERVER_CONFIGURATION=false

# ===== Postgres（第8章起）=====
# 业务库（SQLAlchemy 走 psycopg3）+ checkpointer（psycopg 原生）共用同一个 PG 实例
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/postgres
CHECKPOINT_DB_URL=postgresql://postgres:postgres@localhost:5432/postgres
# 本章可观测增量：加固版连接池参数（本章起读取，ch08/09 忽略）
DB_POOL_SIZE=10
DB_MAX_OVERFLOW=20
DB_POOL_RECYCLE=3600

# AIHUB 知识库（实战，凭据手填，勿提交真实值）
# RAG_PROVIDER=aihub
AIHUB_API_URL=""
AIHUB_USERNAME=""
AIHUB_PASSWORD=""
AIHUB_LIST_RESOURCES_API="/api/datasettag"
AIHUB_RESOURCES_URL=""

```

#### code/tests/test\_increment\_contract.py

修改内容：新增文件：三个增量的边界契约。

```python
import unittest
from config.configuration import Configuration


class IncrementContractTests(unittest.TestCase):
    """新 ch10 跨增量契约：可观测 / MCP / RAG 三增量互不破坏。"""

    def test_mcp_disabled_by_default_does_not_block_researcher(self):
        """MCP 默认关时，researcher 仍走默认工具链（可观测+RAG 不受影响）。"""
        cfg = Configuration(mcp_settings=None, resources=None)
        # 断言：无 mcp_settings 时 researcher 不尝试加载 MCP（默认工具链可用）
        self.assertIsNone(cfg.mcp_settings)

    def test_rag_without_resources_falls_back_to_web(self):
        """RAG 未配 resources 时，local_search_tool 不注入，回退 web_search。"""
        cfg = Configuration(resources=None)
        self.assertIsNone(cfg.resources)

    def test_timing_decorator_is_async_aware(self):
        """可观测 @timed_node 对 async 函数走 _async_wrapper（iscoroutinefunction 分流）。"""
        import asyncio
        from utils.timing import timed_node

        @timed_node
        async def fake_node():
            await asyncio.sleep(0)
            return "ok"

        self.assertTrue(asyncio.iscoroutinefunction(fake_node))
        result = asyncio.run(fake_node())
        self.assertEqual(result, "ok")


if __name__ == "__main__":
    unittest.main()

```

#### code/tests/test\_mcp\_metadata.py

修改内容：新增文件：MCP metadata 契约。

```python
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from server.app import app


class MCPMetadataTests(unittest.TestCase):
    def test_disabled_configuration_is_rejected(self):
        client = TestClient(app)
        with patch.dict("os.environ", {}, clear=True):
            response = client.post(
                "/api/mcp/server/metadata",
                json={"transport": "streamable_http", "url": "http://localhost:3000"},
            )
        self.assertEqual(response.status_code, 403)

    def test_enabled_configuration_returns_loaded_tool_metadata(self):
        client = TestClient(app)
        fake_tool = SimpleNamespace(
            name="search_docs",
            description="Search internal docs",
            args_schema=None,
        )
        with (
            patch.dict(
                "os.environ", {"ENABLE_MCP_SERVER_CONFIGURATION": "true"}
            ),
            patch(
                "server.app.load_mcp_tools",
                new=AsyncMock(return_value=[fake_tool]),
            ),
        ):
            response = client.post(
                "/api/mcp/server/metadata",
                json={"transport": "streamable_http", "url": "http://localhost:3000"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["tools"][0]["name"], "search_docs")


if __name__ == "__main__":
    unittest.main()

```

#### code/tests/test\_rag\_config\_api.py

修改内容：新增文件：RAG API 与 PG service 契约。

```python
"""RAG 配置 API 测试：mock repository 层，验证 service 逻辑。

Mock 范围（不依赖 PostgreSQL，本地秒跑）：
- database.base.get_db（L86）→ 注入 _fake_session，阻止 app startup 连 PG
- server.app.get_db（L104）→ 覆盖 Depends 注入点（app 模块级 import 时捕获的引用）
- database.repository 的 5 个函数（L87-94）→ patch.multiple 注入纯内存 mock

内存 mock 实现（L38-83）：
- _mock_store: dict[str, dict]（L38）— 纯 Python dict 替代 PG 表
- _mock_create（L41）/ _mock_list（L57）/ _mock_update（L61）/ _mock_delete（L69）
  / _mock_query_resources（L73）— 5 个函数模拟 repository 的 CRUD + 资源查询

诚实声明 — mock 局限性：
RAGConfigService 当前是薄 pass-through（create 仅生成 UUID + model_dump，
list/update/delete/query_resources 直转 repository）。因此上述 mock 函数
不可避免地复刻了 repository 的字段提取/过滤逻辑（如 _mock_query_resources
的 casefold 子串匹配与 repository 实现一致）。

⚠ 警告：若未来给 RAGConfigService 增加校验/转换/清洗逻辑（例如 name 长度
校验、ext_config schema 验证、similarity 精度截断），这些 mock 不会暴露问题
——届时需同步更新 mock 实现，或改用真实 PG 集成测试覆盖。

验证什么：
- service 层正确调用 repository 函数（传参、转发返回值）
- FastAPI 端点的 HTTP 状态码、响应结构
- pydantic 校验（similarity 越界 → 422）
- delete 返回 deleted: true
"""
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

# --- mock 进驻点（必须在 import app 之前）---
_fake_session = MagicMock(name="fake_db_session")

# repository 函数的 mock 实现（模拟内存行为）
_mock_store: dict[str, dict] = {}


def _mock_create(db, config_id: str, data: dict) -> dict:
    entry = {
        "id": config_id,
        "name": data["name"],
        "platform": data["platform"],
        "api_url": data.get("api_url", ""),
        "ext_config": data.get("ext_config", {}),
        "retrieval_size": data.get("retrieval_size", 5),
        "similarity": data.get("similarity", 0.5),
        "is_enabled": data.get("is_enabled", True),
        "created_at": "2026-01-01T00:00:00",
    }
    _mock_store[config_id] = entry
    return entry


def _mock_list(db) -> list[dict]:
    return list(_mock_store.values())


def _mock_update(db, config_id: str, changes: dict) -> dict | None:
    entry = _mock_store.get(config_id)
    if entry is None:
        return None
    entry.update(changes)
    return entry


def _mock_delete(db, config_id: str) -> bool:
    return _mock_store.pop(config_id, None) is not None


def _mock_query_resources(db, query: str = "") -> list[dict]:
    needle = query.casefold().strip()

    resources = [ ]

    for entry in _mock_store.values():
        if not entry.get("is_enabled", True):
            continue

        for r in entry.get("ext_config", {}).get("resources", []):

            haystack = " ".join(str(r.get(k, "")) for k in ("uri", "title", "description")).casefold()
            if not needle or needle in haystack:
                resources.append(dict(r))
    return resources


_patcher_get_db = patch("database.base.get_db", return_value=_fake_session)
_patcher_repo = patch.multiple(
    "database.repository",
    list_rag_configs=_mock_list,
    create_rag_config=_mock_create,
    update_rag_config=_mock_update,
    delete_rag_config=_mock_delete,
    query_rag_resources=_mock_query_resources,
)

# 在 mock 生效后 import app（app 模块级 import 会触发 get_db 注册）
_patcher_get_db.start()
_patcher_repo.start()

# 注意：还需 patch app 模块里的 get_db 引用（Depends 拿到的是 app 导入时的 get_db）
from server.app import app  # noqa: E402

# app 里 `Depends(get_db)` 引用的是 server.app 作用域的 get_db，需额外 patch
_patcher_app_get_db = patch("server.app.get_db", return_value=_fake_session)
_patcher_app_get_db.start()


class RAGConfigAPITests(unittest.TestCase):
    def setUp(self):
        """每个测试前清空 mock 存储。"""
        _mock_store.clear()
        self.client = TestClient(app)

    def test_config_crud_and_resource_query(self):
        """完整 CRUD 生命周期 + query_resources（mock repository，无 PG）。"""
        payload = {
            "name": "memory-demo",
            "platform": "memory",
            "api_url": "",
            "ext_config": {
                "resources": [
                    {
                        "uri": "rag://guide",
                        "title": "中文指南",
                        "description": "课程资料",
                        "chunks": ["上下文管理"],
                    }
                ]
            },
            "retrieval_size": 5,
            "similarity": 0.5,
            "is_enabled": True,
        }

        # create
        created = self.client.post("/api/config/rag/save_config", json=payload)
        self.assertEqual(created.status_code, 200)
        config_id = created.json()["data"]["id"]
        self.assertTrue(len(config_id) > 0, "create 应返回非空 id")

        # list
        listed = self.client.get("/api/config/rag/get_config")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["data"][0]["name"], "memory-demo")

        # query_resources
        resources = self.client.get("/api/rag/resources", params={"query": "中文"})
        self.assertEqual(resources.status_code, 200)
        self.assertEqual(resources.json()["resources"][0]["uri"], "rag://guide")

        # update
        updated = self.client.put(
            f"/api/config/rag/{config_id}", json={"name": "updated"}
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["data"]["name"], "updated")

        # delete
        deleted = self.client.delete(f"/api/config/rag/{config_id}")
        self.assertTrue(deleted.json()["deleted"])

    def test_invalid_similarity_returns_structured_detail(self):
        """similarity 超出 [0,1] → 422 + detail。"""
        response = self.client.post(
            "/api/config/rag/save_config",
            json={
                "name": "bad",
                "platform": "memory",
                "api_url": "",
                "ext_config": {},
                "retrieval_size": 5,
                "similarity": 2,
            },
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("detail", response.json())

    def test_update_nonexistent_returns_404(self):
        """更新不存在的 config_id → 404。"""
        response = self.client.put(
            "/api/config/rag/nonexistent_id", json={"name": "ghost"}
        )
        self.assertEqual(response.status_code, 404)

    def test_query_resources_empty_query_returns_all_enabled(self):
        """query_resources 无 query 参数 → 返回所有已启用配置的资源。"""
        self.client.post(
            "/api/config/rag/save_config",
            json={
                "name": "cfg1",
                "platform": "memory",
                "ext_config": {
                    "resources": [
                        {"uri": "rag://a", "title": "Alpha", "description": "第一"},
                    ]
                },
                "is_enabled": True,
            },
        )
        resources = self.client.get("/api/rag/resources")
        self.assertEqual(resources.status_code, 200)
        self.assertEqual(len(resources.json()["resources"]), 1)
        self.assertEqual(resources.json()["resources"][0]["uri"], "rag://a")

    def test_query_resources_filters_by_query(self):
        """query_resources 带 query → 按 uri/title/description 过滤。"""
        self.client.post(
            "/api/config/rag/save_config",
            json={
                "name": "cfg2",
                "platform": "memory",
                "ext_config": {
                    "resources": [
                        {"uri": "rag://python", "title": "Python 教程", "description": "基础"},
                        {"uri": "rag://rust", "title": "Rust 指南", "description": "进阶"},
                    ]
                },
                "is_enabled": True,
            },
        )
        resources = self.client.get("/api/rag/resources", params={"query": "Python"})
        self.assertEqual(len(resources.json()["resources"]), 1)
        self.assertEqual(resources.json()["resources"][0]["uri"], "rag://python")

    def test_delete_nonexistent_returns_false(self):
        """删除不存在的 config_id → deleted: false。"""
        deleted = self.client.delete("/api/config/rag/ghost_id")
        self.assertFalse(deleted.json()["deleted"])


if __name__ == "__main__":
    unittest.main()

```

#### code/tests/test\_aihub\_integration.py

修改内容：新增文件：带环境门控的真实 AIHub 集成测试。

```python
"""AIHub 集成测试：env 门控 + ddddocr 门控。

双重门控确保：
1. 没有设置 AIHUB_API_URL / AIHUB_USERNAME / AIHUB_PASSWORD → skip
2. 没有安装 ddddocr（uv run --extra aihub）→ skip

本地默认环境两个条件都不满足，集成测试全部 skip。
只有显式配置 env + 安装 aihub extra 后才会执行真实网络调用。
"""
import os
import unittest


def _ddddocr_available() -> bool:
    """检查 ddddocr 是否已安装（try import，不 load_dotenv）。"""
    try:
        import ddddocr  # noqa: F401
        return True
    except ImportError:
        return False


@unittest.skipUnless(
    all(os.getenv(v) for v in ("AIHUB_API_URL", "AIHUB_USERNAME", "AIHUB_PASSWORD")),
    "AIHUB 集成测试需 AIHUB_API_URL/USERNAME/PASSWORD 环境变量",
)
@unittest.skipUnless(
    _ddddocr_available(), "AIHUB 集成测试需 ddddocr（uv run --extra aihub）"
)
class AIHubIntegrationTests(unittest.TestCase):
    """AIHub 真实集成测试（连接 AIHUB_API_URL 指向的服务）。

    需要同时满足：
    - 环境变量 AIHUB_API_URL / AIHUB_USERNAME / AIHUB_PASSWORD 已设置
    - ddddocr 已安装（uv run --extra aihub）
    """

    @classmethod
    def setUpClass(cls):
        from rag.aihub import AIHubProvider

        cls.provider = AIHubProvider(
            rag_platform_id="aihub",
            api_url=os.getenv("AIHUB_API_URL"),
            username=os.getenv("AIHUB_USERNAME"),
            password=os.getenv("AIHUB_PASSWORD"),
            retrieval_size=5,
            similarity=0.4,
        )

    def test_connection(self):
        """测试连接：登录 + list_resources，返回 success=True。"""
        result = self.provider.test_connection()
        self.assertTrue(result["success"], result["message"])
        self.assertIsInstance(result["resource_count"], int)

    def test_list_and_query(self):
        """闭环测试：list_resources → query_relevant_documents。

        步骤：
        1. list_resources() 获取资源列表
        2. 取第一条资源构造 query_relevant_documents 调用
        3. 验证返回 Document 列表非空且字段完整
        """
        resources = self.provider.list_resources(use_cache=False)
        self.assertGreater(len(resources), 0, "list_resources 应返回至少一条资源")

        # 取第一条资源做 query
        first = resources[0]
        documents = self.provider.query_relevant_documents(
            query="测试查询", resources=[first]
        )

        # 验证返回的 Document 结构
        self.assertIsInstance(documents, list)
        if documents:
            doc = documents[0]
            self.assertTrue(hasattr(doc, "id"))
            self.assertTrue(hasattr(doc, "chunks"))
            self.assertIsInstance(doc.chunks, list)


if __name__ == "__main__":
    unittest.main()

```

#### code/tests/test\_skip\_contract.py

修改内容：完整覆盖：retry/skip 状态机契约。

```python
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage

from graph.nodes import _execute_agent_step, eval_node
from prompts.planner_model import Plan, Step
from server.app import app
from server.thread_state_manager import thread_state_manager


class SkipContractTests(unittest.TestCase):
    def tearDown(self):
        thread_state_manager.clear("thread-skip-test")

    def test_skip_accepts_frontend_json_body(self):
        client = TestClient(app)

        response = client.post(
            "/api/chat/skip", json={"thread_id": "thread-skip-test"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["skip_set"])
        self.assertTrue(thread_state_manager.get_skip_state("thread-skip-test"))

    def test_skip_during_stream_discards_partial_result_and_finishes_current_step(self):
        class FakeAgent:
            async def astream(self, *_args, **_kwargs):
                yield {"messages": [AIMessage(content="partial")]}
                thread_state_manager.set_skip_state("thread-skip-test", True)
                yield {"messages": [AIMessage(content="should be discarded")]}

        plan = Plan(
            locale="zh-CN",
            has_enough_context=False,
            title="test",
            steps=[
                Step(
                    need_search=True,
                    title="current",
                    description="current step",
                    step_type="research",
                    execution_res="previous usable result",
                )
            ],
        )

        low_evaluation = {
            "quality_score": 0.4,
            "feedback": "needs more evidence",
        }
        with (
            patch("graph.nodes.get_stream_writer", return_value=lambda _event: None),
            patch(
                "graph.nodes._evaluate_research_step",
                new=AsyncMock(return_value=low_evaluation),
            ),
        ):
            asyncio.run(
                eval_node(

                    {"current_plan": plan, "evaluation_history": []},

                    {
                        "configurable": {
                            "min_quality_score": 0.7,
                            "max_step_iterations": 2,
                        }
                    },
                )
            )

        self.assertIsNone(plan.steps[0].execution_res)
        self.assertEqual(plan.steps[0].last_execution_res, "previous usable result")
        self.assertEqual(plan.steps[0].last_evaluation_result, low_evaluation)

        with patch("graph.nodes._log_node_event"):
            command = asyncio.run(
                _execute_agent_step(
                    # step="step0" 绕过 _execute_agent_step 的哨兵（首次进入会 update step 再回退），
                    # 让本测试专注验证"流式中途 skip 中断"这条路径本身。
                    {"current_plan": plan, "step": "step0"},
                    FakeAgent(),
                    "researcher",
                    {
                        "configurable": {
                            "thread_id": "thread-skip-test",
                            "max_step_iterations": 2,
                        }
                    },
                )
            )

        self.assertEqual(plan.steps[0].execution_res, "previous usable result")
        self.assertEqual(
            plan.steps[0].evaluation_result,
            low_evaluation,
        )
        self.assertEqual(plan.steps[0].step_iterations, 3)
        self.assertFalse(thread_state_manager.get_skip_state("thread-skip-test"))
        self.assertEqual(command.goto, "research_team")
        self.assertNotIn("observations", command.update)


if __name__ == "__main__":
    unittest.main()

```

#### code/tests/test\_stream\_contract.py

修改内容：完整覆盖：SSE、interrupt 和流式分轨契约。

```python
import asyncio
import html
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from langchain_core.messages import AIMessage, AIMessageChunk
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import Base, ChatStream
from database.repository import list_conversations as query_conversations
from prompts.planner_model import Plan, Step
from server.app import (
    _astream_workflow_generator,
    _create_interrupt_event,
    _process_message_chunk,
    _stream_graph_events,
    delete_conversation,
    get_conversation,
    list_conversations,
)


async def collect_events(generator):
    return [event async for event in generator]


def make_state(**values):
    return SimpleNamespace(values=values)


class StreamContractTests(unittest.TestCase):
    def test_intermediate_text_chunk_has_no_finish_reason(self):
        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            events = asyncio.run(
                collect_events(
                    _process_message_chunk(
                        AIMessageChunk(content="片段"), {}, "thread-1", make_state()
                    )
                )
            )

        self.assertEqual(events[0][0], "message_chunk")
        self.assertNotIn("finish_reason", events[0][1])

    def test_message_base_reads_role_step_and_reexecution_from_state(self):
        plan = Plan(
            locale="zh-CN",
            has_enough_context=False,
            title="计划",
            steps=[
                Step(
                    need_search=True,
                    title="检索",
                    description="检索资料",
                    step_type="research",
                    step_iterations=2,
                )
            ],
        )
        state = make_state(step="step0", step_title="检索", current_plan=plan)

        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            events = asyncio.run(
                collect_events(
                    _process_message_chunk(
                        AIMessageChunk(content="片段"),
                        {"langgraph_node": "researcher"},
                        "thread-1",
                        state,
                    )
                )
            )

        data = events[0][1]
        self.assertEqual(data["role"], "assistant")
        self.assertEqual(data["step"], "step0")
        self.assertEqual(data["step_title"], "检索")
        self.assertEqual(data["additional_info"]["re_execute_times"], 2)
        self.assertEqual(
            data["additional_info"]["activity"],
            {"activity_type": "execute_research", "activity_name": "执行研究"},
        )

    def test_react_subgraph_namespace_is_reported_as_researcher(self):
        plan = Plan(
            locale="zh-CN",
            has_enough_context=False,
            title="计划",
            steps=[
                Step(
                    need_search=True,
                    title="研究",
                    description="执行研究",
                    step_type="research",
                    step_iterations=1,
                )
            ],
        )
        state = make_state(step="step0", step_title="研究", current_plan=plan)

        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            events = asyncio.run(
                collect_events(
                    _process_message_chunk(
                        AIMessageChunk(content="重试中"),
                        {"langgraph_node": "agent"},
                        "thread-1",
                        state,
                        agent_path=("researcher:react-agent",),
                    )
                )
            )

        data = events[0][1]
        self.assertEqual(data["agent"], "researcher")
        self.assertEqual(data["additional_info"]["re_execute_times"], 1)
        self.assertNotIn("checkpoint_id", data)

    def test_stream_graph_passes_current_state_to_message_processor(self):
        state = make_state(step="step0")

        class FakeGraph:
            async def astream(self, *_args, **_kwargs):
                yield ("root", (AIMessageChunk(content="片段"), {}))

            async def aget_state(self, _config):
                return state


        seen = [ ]


        async def fake_process(
            _chunk, _metadata, _thread_id, current_state, agent_path=()
        ):
            seen.append(current_state)
            if False:
                yield None

        with patch("server.app._process_message_chunk", side_effect=fake_process):
            asyncio.run(
                collect_events(
                    _stream_graph_events(FakeGraph(), {}, {}, "thread-1")
                )
            )

        self.assertEqual(seen, [state])

    def test_eval_internal_chunks_are_not_exposed_as_chat_text(self):
        """对齐主项目：评估器内部 structured-output token 不得作为正文显示。"""
        chunk = AIMessageChunk(content='{"quality_score": 0.95}')
        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            events = asyncio.run(
                collect_events(
                    _process_message_chunk(
                        chunk,
                        {"langgraph_node": "eval"},
                        "thread-1",
                        make_state(),
                    )
                )
            )


        self.assertEqual(events, [])


    def test_evaluation_messages_forward_and_prefer_message_reexecution_count(self):
        evaluation_data = {
            "step_id": "step-1",
            "step_title": "检索",
            "step_type": "research",
            "quality_score": 0.9,
            "feedback": "很好",
            "evaluation_timestamp": "2026-07-21T00:00:00",
            "evaluator_name": "evaluator",
            "evaluation_status": "completed",
        }
        chunk = AIMessage(
            content="研究步骤评估结果",
            additional_kwargs={
                "evaluation_data": evaluation_data,
                "re_execute_times": 3,
            },
            response_metadata={"finish_reason": "stop"},
        )
        state = make_state(step="step0", step_title="检索")

        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            eval_events = asyncio.run(
                collect_events(
                    _process_message_chunk(
                        chunk, {"langgraph_node": "eval"}, "thread-1", state
                    )
                )
            )
            final_events = asyncio.run(
                collect_events(
                    _process_message_chunk(
                        chunk,
                        {"langgraph_node": "final_report_evaluator"},
                        "thread-1",
                        state,
                    )
                )
            )

        for events in (eval_events, final_events):
            self.assertEqual(events[0][0], "evaluation")
            self.assertEqual(events[0][1]["evaluation_data"], evaluation_data)
            self.assertEqual(
                events[0][1]["additional_info"]["re_execute_times"], 3
            )
            self.assertEqual(events[0][1]["finish_reason"], "stop")

    def test_normal_node_and_reporter_stop_are_not_filtered(self):
        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            normal = asyncio.run(
                collect_events(
                    _process_message_chunk(
                        AIMessageChunk(content="正文"),
                        {"langgraph_node": "researcher"},
                        "thread-1",
                        make_state(),
                    )
                )
            )
            reporter = asyncio.run(
                collect_events(
                    _process_message_chunk(
                        AIMessageChunk(
                            content="完成",
                            response_metadata={"finish_reason": "stop"},
                        ),
                        {"langgraph_node": "reporter"},
                        "thread-1",
                        make_state(),
                    )
                )
            )

        self.assertEqual(normal[0][0], "message_chunk")
        self.assertEqual(reporter[0][0], "message_chunk")
        self.assertEqual(reporter[0][1]["finish_reason"], "stop")

    def test_tool_calls_event_always_includes_chunk_array(self):
        """前端 mergeToolCallMessage 会遍历 tool_call_chunks；缺字段会中断整个 SSE 消费。"""
        chunk = AIMessageChunk(
            content="",
            tool_calls=[
                {
                    "name": "handoff_to_planner",
                    "args": {},
                    "id": "call-1",
                    "type": "tool_call",
                }
            ],
        )
        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            events = asyncio.run(
                collect_events(
                    _process_message_chunk(chunk, {}, "thread-1", make_state())
                )
            )

        self.assertEqual(events[0][0], "tool_calls")
        self.assertIn("tool_call_chunks", events[0][1])
        self.assertIsInstance(events[0][1]["tool_call_chunks"], list)

    def test_tool_argument_chunks_use_dedicated_event(self):
        """后续工具参数分片必须继续推给前端，否则 finish_reason 到来时 JSON 仍不完整。"""
        chunk = AIMessageChunk(
            content="",
            tool_call_chunks=[
                {
                    "name": None,
                    "args": '比声速"}',
                    "id": None,
                    "index": 0,
                    "type": "tool_call_chunk",
                }
            ],
        )
        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            events = asyncio.run(
                collect_events(
                    _process_message_chunk(chunk, {}, "thread-1", make_state())
                )
            )

        self.assertEqual(events[0][0], "tool_call_chunks")
        self.assertEqual(
            events[0][1]["tool_call_chunks"][0]["args"],
            '比声速"&#125;',
        )

    def test_real_tool_chunk_chain_merges_to_parseable_json(self):
        chunks = [
            AIMessageChunk(
                content="",
                tool_call_chunks=[
                    {
                        "name": "search",
                        "args": '{"query":"光速",',
                        "id": "call-1",
                        "index": 0,
                        "type": "tool_call_chunk",
                    }
                ],
            ),
            AIMessageChunk(
                content="",
                tool_call_chunks=[
                    {
                        "name": None,
                        "args": '"topic":"与声速',
                        "id": None,
                        "index": 0,
                        "type": "tool_call_chunk",
                    }
                ],
            ),
            AIMessageChunk(
                content="",
                tool_call_chunks=[
                    {
                        "name": None,
                        "args": '比较"}',
                        "id": None,
                        "index": 0,
                        "type": "tool_call_chunk",
                    }
                ],
            ),
            AIMessageChunk(
                content="",
                response_metadata={"finish_reason": "tool_calls"},
            ),
        ]

        async def run_chain():

            all_events = [ ]

            for chunk in chunks:
                all_events.extend(
                    await collect_events(
                        _process_message_chunk(chunk, {}, "thread-1", make_state())
                    )
                )
            return all_events

        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            events = asyncio.run(run_chain())


        args_chunks = [ ]

        for event_type, data in events:
            if event_type in ("tool_calls", "tool_call_chunks"):
                args_chunks.extend(

                    chunk["args"] for chunk in data.get("tool_call_chunks", [])

                )
        parsed = json.loads(html.unescape("".join(args_chunks)))

        self.assertEqual([event[0] for event in events], [
            "tool_calls",
            "tool_call_chunks",
            "tool_call_chunks",
            "message_chunk",
        ])
        self.assertEqual(events[-1][1]["finish_reason"], "tool_calls")
        self.assertEqual(parsed, {"query": "光速", "topic": "与声速比较"})

    def test_interrupt_contract_for_all_review_types_and_empty_namespace(self):
        expected_options = {
            "plan_review": [
                {"text": "修改计划", "value": "edit_plan"},
                {"text": "开始研究", "value": "accepted"},
            ],
            "retriever_review": [
                {"text": "Continue", "value": "continue"},
                {"text": "Reselect Resources", "value": "reselect"},
            ],
            "llm_output_review": [{"text": "Continue", "value": "continue"}],
            "report_review": [
                {"text": "接受报告", "value": "accepted"},
                {"text": "重新生成", "value": "continue"},
            ],
        }
        state = make_state(step="step1", step_title="审核")

        with patch("server.app._make_event", side_effect=lambda kind, data: (kind, data)):
            for node_type, options in expected_options.items():
                interrupt_obj = SimpleNamespace(
                    value={
                        "type": node_type,
                        "message": "请确认",
                        "re_execute_times": 2,
                    },

                    ns=[],

                )
                event_type, data = _create_interrupt_event(
                    "thread-1", {"__interrupt__": [interrupt_obj]}, state
                )
                self.assertEqual(event_type, "interrupt")
                self.assertEqual(data["thread_id"], "thread-1")
                self.assertEqual(data["role"], "assistant")
                self.assertEqual(data["content"], "请确认")
                self.assertEqual(data["node_type"], node_type)
                self.assertEqual(data["finish_reason"], "interrupt")
                self.assertEqual(data["options"], options)
                self.assertTrue(data["id"].startswith("intr--"))
                self.assertEqual(data["step"], "step1")
                self.assertEqual(data["step_title"], "审核")
                self.assertEqual(data["additional_info"], {"re_execute_times": 2})

    def test_resume_command_carries_edited_plan_and_feedback_text(self):
        edited = {"title": "新计划", "steps": [{"title": "新步骤"}]}
        captured = {}

        async def fake_stream(_graph, workflow_input, _config, _thread_id):
            captured["workflow_input"] = workflow_input
            if False:
                yield None

        from server.chat_request import ChatRequest

        request = ChatRequest(
            messages=[{"role": "user", "content": "请把第二步改成对比实验"}],
            thread_id="thread-1",
            interrupt_feedback="edit_plan",
            plan=edited,
        )
        with (
            patch("server.app._make_event"),
            patch("server.app._stream_graph_events", side_effect=fake_stream),
        ):
            asyncio.run(collect_events(_astream_workflow_generator(request, "thread-1")))

        command = captured["workflow_input"]
        self.assertEqual(command.resume, "[edit_plan] 请把第二步改成对比实验")
        self.assertEqual(command.update["edited_plan"], edited)

    def test_conversation_list_uses_data_envelope(self):
        db = object()
        with patch(
            "server.app.repository.list_conversations",
            return_value=[{"thread_id": "thread-1"}],
        ):
            response = list_conversations(db)

        self.assertEqual(response, {"data": [{"thread_id": "thread-1"}]})

    def test_conversation_list_matches_frontend_contract(self):
        """沿用 ch08 实现后，仍要满足 ConversationsDialog 所需六字段。"""
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        session_factory = sessionmaker(bind=engine)
        db = session_factory()
        try:
            db.add_all(
                [
                    ChatStream(
                        thread_id="thread-1",
                        event_type="message_chunk",
                        content=json.dumps(
                            {"role": "user", "content": "请调研光速与声速"},
                            ensure_ascii=False,
                        ),
                    ),
                    ChatStream(
                        thread_id="thread-1",
                        event_type="message_chunk",
                        content=json.dumps(
                            {"role": "assistant", "content": "开始"},
                            ensure_ascii=False,
                        ),
                    ),
                ]
            )
            db.commit()

            conversations = query_conversations(db)
        finally:
            db.close()

        self.assertEqual(len(conversations), 1)
        item = conversations[0]
        self.assertEqual(item["id"], "thread-1")
        self.assertEqual(item["title"], "请调研光速与声速")
        self.assertEqual(item["count"], 2)
        self.assertEqual(item["category"], "research")
        self.assertEqual(item["data_type"], "chat")
        self.assertIsNotNone(item["date"])

    def test_conversation_list_falls_back_when_first_frame_is_scalar_json(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        session_factory = sessionmaker(bind=engine)
        db = session_factory()
        try:
            db.add(
                ChatStream(
                    thread_id="thread-scalar",
                    event_type="message_chunk",
                    content=json.dumps("valid scalar"),
                )
            )
            db.commit()

            conversations = query_conversations(db)
        finally:
            db.close()

        self.assertEqual(conversations[0]["title"], "thread-scalar")

    def test_delete_conversation_clears_checkpoint_and_returns_contract(self):
        db = object()
        with (
            patch(
                "server.app.graph.checkpointer.adelete_thread",
                new_callable=unittest.mock.AsyncMock,
            ) as delete_checkpoint,
            patch(
                "server.app.repository.delete_conversation",
                return_value=2,
            ) as delete_streams,
        ):
            response = asyncio.run(delete_conversation("thread-1", db))

        delete_checkpoint.assert_awaited_once_with("thread-1")
        delete_streams.assert_called_once_with(db, "thread-1")
        self.assertEqual(
            response,
            {
                "thread_id": "thread-1",
                "deleted": True,
                "message": "Conversation deleted successfully",
            },
        )

    def test_conversation_history_is_replayable_sse_text(self):
        db = object()
        rows = [
            {
                "event_type": "message_chunk",
                "content": json.dumps({"content": "hello"}),
                "finish_reason": "",
            }
        ]
        with patch("server.app.repository.get_conversation", return_value=rows):
            response = get_conversation("thread-1", db)

        self.assertTrue(response.media_type.startswith("text/plain"))
        self.assertEqual(
            response.body.decode(),
            'event: message_chunk\ndata: {"content": "hello"}\n\n',
        )


if __name__ == "__main__":
    unittest.main()

```

### 5.9 分步验证命令

```bash
cd tutorial/chapter10_研究过程增强/code
uv sync
uv run python -m unittest tests.test_increment_contract -v
uv run python -m unittest tests.test_mcp_metadata -v
uv run python -m unittest tests.test_rag_config_api -v
uv run python -m unittest tests.test_skip_contract -v
uv run python -m unittest tests.test_stream_contract -v
uv run python -m unittest discover -s tests -v

```

AIHub 真实集成测试仅在配置凭据并安装 extra 后运行：

```bash
uv sync --extra aihub
uv run python -m unittest tests.test_aihub_integration -v

```

## 章末验收

```bash
cd tutorial/chapter10_研究过程增强/code
uv run python -m unittest discover -s tests -v
uv run server.py

```

发起一次研究请求后检查服务日志中的 `[timing]` 输出；验证 `SHOW statement_timeout` 返回 `30s`；MCP 不传配置时沿用默认工具，传配置但未开开关时返回 403；通过 RAG 保存接口写入配置后，聊天请求携带 `resources` 即可触发本地检索。

AIHUB 拓展验收：RAG 配置 API 测试（mock repository，不依赖 PG）通过 `test_rag_config_api.py`；AIHUB 集成测试（需凭据 + ddddocr）默认 skip，设置环境变量后可执行真实闭环测试。

![deepresearch-ch10.svg](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/oJGq750rZMzYylAK/img/cf213f97-9e80-433e-93fe-1d717ec14f24.svg)

[请至钉钉文档查看附件《web.zip》。](https://alidocs.dingtalk.com/i/nodes/vy20BglGWOMvrre0tgGB37gDJA7depqY?doc_type=wiki_doc&iframeQuery=anchorId%3DX02mrx6znkbi4h943tyck)

[请至钉钉文档查看附件《code.zip》。](https://alidocs.dingtalk.com/i/nodes/vy20BglGWOMvrre0tgGB37gDJA7depqY?doc_type=wiki_doc&iframeQuery=anchorId%3DX02mrx74bduqwjm5imdfvk)