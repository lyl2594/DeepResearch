# [0.3.1](http://192.168.8.217/aiproject/deepResearch/compare/v0.3.1) (2026-01-04)

### Bug Fixes

* **server:** 为_stream_graph_events设置默认run_id值 ([844c74b](http://192.168.8.217/aiproject/deepResearch/commits/844c74b0cdf23321d2a2449ac0146af0c8671f8d))
* **i18n:** 添加计划相关多语言支持并更新按钮文本 ([aac52ab](http://192.168.8.217/aiproject/deepResearch/commits/aac52abd61de7f548e88926465cea1e8901ca29c))


### Features

* **graph:** 添加多语言搜索功能支持 ([26473a9](http://192.168.8.217/aiproject/deepResearch/commits/26473a92ac078708e138c9278005fbdd62ff54f3))
* **graph:** 重构知识库识别节点并提取公共函数 ([8827e7f](http://192.168.8.217/aiproject/deepResearch/commits/8827e7f9028e066b96c3d3eac63a61c9aac8a1c7))
* **rag:** 实现知识库管理功能 ([aa6e44f](http://192.168.8.217/aiproject/deepResearch/commits/aa6e44fcca4e7693a2a6b0c80edd44ae34a75318))
* **rag:** 支持多知识库平台检索功能 ([f5f02f7](http://192.168.8.217/aiproject/deepResearch/commits/f5f02f7aad3f13ea56f1416afba3150353ec0489))
* **rag:** 添加 Dify 作为新的 RAG 提供者 ([378931c](http://192.168.8.217/aiproject/deepResearch/commits/378931c28efa35c893380e325a312eb22c092a17))
* **rag:** 添加相似度阈值配置项 ([6778e85](http://192.168.8.217/aiproject/deepResearch/commits/6778e8554d13670767ec76eb3118843c5f4fc3f4))
* **rag:** 添加自动选择知识库功能 ([717f8bb](http://192.168.8.217/aiproject/deepResearch/commits/717f8bb3cc0ee3e4e34d3f1ddd509bfa26b128e7))
* **知识库:** 添加AIHUB知识库支持 ([1be83c2](http://192.168.8.217/aiproject/deepResearch/commits/1be83c2e6d603156788bde8a2b05ab2e1c5fd5aa))
* **知识库:** 重构知识库配置管理功能 ([91d7c31](http://192.168.8.217/aiproject/deepResearch/commits/91d7c31c9895a79d15be07bdaf913cc9ce0b12a5))
* **日志管理:** 添加日志管理功能 ([8d9269](http://192.168.8.217/aiproject/deepResearch/commits/8d926979fe46b3938aef0b2e6baf8c38be40012e))

# [v0.3](http://192.168.8.217/aiproject/deepResearch/compare/v0.3) (2025-12-12)


### Bug Fixes

* **chat:** 修复 options.plan 可能为 undefined 时的访问错误 ([02348d2](http://192.168.8.217/aiproject/deepResearch/commits/02348d28fe2c33710dbd2942345054a301e2864d))
* **chat:** 修复回放时倒计时未清除的问题 ([a56c507](http://192.168.8.217/aiproject/deepResearch/commits/a56c507fb72ad21fbcd3ed074879a009ae54a3f8))
* **graph:** 修复步骤质量评分检查逻辑 ([6960915](http://192.168.8.217/aiproject/deepResearch/commits/696091512c560a10fab90b4a7460895723d51f42))
* **graph:** 修复重试过程中知识库检索交互组件位置错乱的问题 ([f98f976](http://192.168.8.217/aiproject/deepResearch/commits/f98f976c0648b3fe455d00992a69f76668e434d5))
* **server:** 扩展评估消息检查条件以包含特定活动类型描述 ([6fa2458](http://192.168.8.217/aiproject/deepResearch/commits/6fa24587a4c1fd473ef8a3e7d69733285f93c773))
* 修复评估过程中的异常处理和日志记录 ([68f4c03](http://192.168.8.217/aiproject/deepResearch/commits/68f4c0367e11cd13ba280eb28e158a0367597fb8))
* 关键引用根据名称去重 ([36bbdf2](http://192.168.8.217/aiproject/deepResearch/commits/36bbdf22fa018b195927c6da080bec580d0927d0))
* 回放直出卡顿修改 ([b4c2dfe](http://192.168.8.217/aiproject/deepResearch/commits/b4c2dfe8c93b35c59173a74624a638003d8e9da7))
* 知识库来源文字截取错误修复 ([0e5995f](http://192.168.8.217/aiproject/deepResearch/commits/0e5995f09e6a039e1e14d76c09985f004228338a))
* 重新生成计划后编辑按钮置灰 ([1c4755c](http://192.168.8.217/aiproject/deepResearch/commits/1c4755ca740b989b3c03e013b8788f40555b62d3))


### Features

* **activities:** 添加活动类型枚举并在节点和服务器中使用 ([a520dab](http://192.168.8.217/aiproject/deepResearch/commits/a520dab0838cf5c4d3926ece1ad8b315ec02f8ed))
* **aihub:** 添加验证码自动识别功能并集成ddddocr依赖 ([077015e](http://192.168.8.217/aiproject/deepResearch/commits/077015e7a5cacb6eafcaaa421f6fadddb0cfba5d))
* **backend:** 支持跳过重试执行步骤 ([e88c5b8](http://192.168.8.217/aiproject/deepResearch/commits/e88c5b82b35cb1c1d79ec9792e116d36a110f73b))
* **config:** 添加RAG功能开关并优化检索逻辑 ([77bbc82](http://192.168.8.217/aiproject/deepResearch/commits/77bbc8220ffd9d72be66eaa6f04f6e60742002e4))
* **graph:** 添加对Qwen3-32B-FP8推理模型的支持 ([cbd8802](http://192.168.8.217/aiproject/deepResearch/commits/cbd8802035978be12a83bf2166a041bd27bd8d33))
* **research:** 实现研究结果直接输出控制功能 ([1a57f45](http://192.168.8.217/aiproject/deepResearch/commits/1a57f456f922a57833111cfb758e4c13b34749c0))
* **settings:** 添加max_step_retry和min_step_score配置项 ([0b9870e](http://192.168.8.217/aiproject/deepResearch/commits/0b9870e3cd43ff24f70286667cd7d02e8cb89f87))
* **settings:** 添加RAG和研究步骤配置的国际化支持 ([f1e81b9](http://192.168.8.217/aiproject/deepResearch/commits/f1e81b9ba0cc2c70ef18e62790f850a9a92d0e8a))
* **settings:** 添加变更日志标签页及内容展示功能 ([3f74f6d](http://192.168.8.217/aiproject/deepResearch/commits/3f74f6d7f9ba4a6ba245bd10c61baeab6a88a144))
* **thread-state:** 增加文档检索和网络搜索状态管理 ([4ca22d5](http://192.168.8.217/aiproject/deepResearch/commits/4ca22d58d508fc21e149fd37ef65a5f56fd166dc))
* **节点执行:** 添加上一步检索文档支持并优化文档处理流程 ([a69b6ac](http://192.168.8.217/aiproject/deepResearch/commits/a69b6ac64cfc57ab51629f3e2bb207f4e3051ff3))


### Performance Improvements

* **aihub:** 优化token管理逻辑，移除冗余锁操作并调整过期时间检查 ([f491514](http://192.168.8.217/aiproject/deepResearch/commits/f4915140268bf1b6012fdc84589bcfc768acabf5))
* **aihub:** 增加登录和知识库请求的日志记录，优化token过期时间和异常处理 ([87de6c6](http://192.168.8.217/aiproject/deepResearch/commits/87de6c631099cae74ebf1c656c6d5cc358c4d72e))
* **chat:** 优化部分代码 ([6549cc5](http://192.168.8.217/aiproject/deepResearch/commits/6549cc524493fde05558e388b1c3f0a5204c5e84))
* 优化跳过当前重试操作的功能 ([0c9ce2c](http://192.168.8.217/aiproject/deepResearch/commits/0c9ce2cc1436dc4325a48db5755c5242e6338077))
* 使用Web Worker实现智能打字机效果优化回放体验 ([aa59d08](http://192.168.8.217/aiproject/deepResearch/commits/aa59d081f9d843c2440dfc8ec4a03c2c1b18f8a1))
* 回放使用requestAnimationFrame代替settimeout，避免阻塞渲染 ([59f6d1a](http://192.168.8.217/aiproject/deepResearch/commits/59f6d1aab7e44964e424842aac50614d818a60ad))
* 回放显示title ([5391579](http://192.168.8.217/aiproject/deepResearch/commits/539157933865091705476fdfbfe9093d235dd5aa))
* 当前执行任务评估研究结果显示 ([e289e4d](http://192.168.8.217/aiproject/deepResearch/commits/e289e4da6883b51ee06b4d109e1cae71c185a20b))
* 思考过程输出展示修改 ([940276f](http://192.168.8.217/aiproject/deepResearch/commits/940276f549168dd0fd5a426add009f63890bf027))
* 执行过程不显示报告思考过程 ([71e022f](http://192.168.8.217/aiproject/deepResearch/commits/71e022fca75684db7145633813653b4f4201955d))
* 文案修改 ([e6d2152](http://192.168.8.217/aiproject/deepResearch/commits/e6d21525614cf3b5fa69aed5f68fb186181aedd5))
* 显示当前正在进行的活动名称 ([cfc2a6f](http://192.168.8.217/aiproject/deepResearch/commits/cfc2a6f082e1ff1f7fff3a0163b00f35b5ddd58c))
* 显示当前活动输出的类型 ([ecd2e8c](http://192.168.8.217/aiproject/deepResearch/commits/ecd2e8c1a7e40a2bcaa768ad452153ce6180c1ec))
* 添加是否开启rag、隐藏播客按钮、活动标签页文案修改、 ([5dbd74f](http://192.168.8.217/aiproject/deepResearch/commits/5dbd74f5890be8b42eaf03327c489000efbc07e4))
* 评估结果第一条数据不展示 ([ebf511a](http://192.168.8.217/aiproject/deepResearch/commits/ebf511a0a8ec231942a2f3e1d17e2bfef77a2daf))


# [v0.2.2](http://192.168.8.217/aiproject/deepResearch/-/tags/v0.2.2) (2025-11-19)


### Bug Fixes

* **aihub:** 解决环境变量不生效的问题 ([4ec06cb](http://192.168.8.217/aiproject/deepResearch/commits/4ec06cba686a4813e101ffc0cdfae104eee845ec))
* 优化web搜索和文档检索功能 ([f9a37dd](http://192.168.8.217/aiproject/deepResearch/commits/f9a37ddff4108db82bd845944ed791dc3bc44e4d))


### Features
* 添加强制web搜索功能 ([0ff8d7dd](http://192.168.8.217/aiproject/deepResearch/commits/0ff8d7dd37d5488c7b4aca052ede2025722e498c))
* **frontend:** 编辑计划 ([b002e3a](http://192.168.8.217/aiproject/deepResearch/commits/b002e3a970c00dd0ef360e07b717f91944befe84))
* 添加对SearxNG搜索引擎的支持，更新相关配置和工具 ([eca01e0](http://192.168.8.217/aiproject/deepResearch/commits/eca01e0aa00e00faeacf74314c0058d44aea86dd))
* 添加计划编辑功能，合并用户编辑的计划内容 ([7028484](http://192.168.8.217/aiproject/deepResearch/commits/70284841fd08918dbde8d98b6fdb7bbc25ad2930))
* 添加评估模型支持 ([4c7773a](http://192.168.8.217/aiproject/deepResearch/commits/4c7773a9bd40100b2cdb39c21dab099db03a88c5))
* 添加回放倍率设置功能([94cd684](http://192.168.8.217/aiproject/deepResearch/commits/94cd684f97e97ce13e7f81940bf7b14c41a2e0d9))


# [v0.2.1](http://192.168.8.217/aiproject/deepResearch/-/tags/v0.2.1) (2025-11-19)
### Bug Fixes

* **gitignore:** 更新 gitignore ([2fe3056](http://192.168.8.217/aiproject/deepResearch/commits/2fe3056644b915cf55c394364bc7b57923671c88))
* 修复JSON解析中的正则表达式，确保正确处理带有```json标记的字符串 ([907591b](http://192.168.8.217/aiproject/deepResearch/commits/907591b61b6b13e7408c4248537ecda39adf7526))
* 报告输出完成后再显示已完成 ([c974931](http://192.168.8.217/aiproject/deepResearch/commits/c9749315da41b006c1b372d93d837b2bb3480b49))


### Features

* 优化MCP服务器对headers的处理，确保在存在时才传递 ([4d9103e](http://192.168.8.217/aiproject/deepResearch/commits/4d9103efd60403706a90d1388385faf0c776022e))
* 优化PostgreSQL和MongoDB检查点处理，增强连接池管理和章节编号删除功能 ([64bef93](http://192.168.8.217/aiproject/deepResearch/commits/64bef93017bf96c9ba50b41cc04d684737208a70))
* 扩展Window接口以支持__NEXT_PUBLIC_API_URL__变量 ([dbc270f](http://192.168.8.217/aiproject/deepResearch/commits/dbc270f85d959d5bd0b206ee3335672c470d84f2))
* 更新Dockerfile以及扩展MCP配置 ([847cd62](http://192.168.8.217/aiproject/deepResearch/commits/847cd62b9f98f20145635317912b409353ba8e6a))
* 添加MCP服务器配置的JSON格式验证和错误提示 ([f68f185](http://192.168.8.217/aiproject/deepResearch/commits/f68f185a10d0483337ebec200aecd7b71714e5b2))
* 添加编辑和刷新MCP服务器的功能 ([85f2e28](http://192.168.8.217/aiproject/deepResearch/commits/85f2e2817e1d46e213f9110795a6bf5b5b8941a2))


# [v0.2](http://192.168.8.217/aiproject/deepResearch/-/tags/v0.2) (2025-10-24)

## 重要更新

### Bug Fixes

* **template:** 修复自定义模板更新逻辑中内置模板校验问题 ([de3287a](http://192.168.8.217/aiproject/deepResearch/commits/de3287ab0797be55c1089585b5b8f69e8172edbc))
* 下载内容追加关键引用字符串 ([e7c3e58](http://192.168.8.217/aiproject/deepResearch/commits/e7c3e5857f125992d6d2e88beb4169348fed9ad2))
* 关键引用修改 ([3a2d674](http://192.168.8.217/aiproject/deepResearch/commits/3a2d6743099dad40d689014e0c0d6486cc488509))
* 定时器修改 ([2614873](http://192.168.8.217/aiproject/deepResearch/commits/26148732e469eb1fa8e927ff6957434c3c104ffb))
* 报告内容显示加载中修改 ([3685284](http://192.168.8.217/aiproject/deepResearch/commits/368528466636ac74c65c16e7d3600cac3ad3b17a))
* 检索倒计时修改 ([1afe415](http://192.168.8.217/aiproject/deepResearch/commits/1afe415195633a0e85b3e5121452a666cdec47f8))
* 首页暗黑模式未生效修改 ([c864ecb](http://192.168.8.217/aiproject/deepResearch/commits/c864ecb34209b928fb5710455059e6add6b10219))
* 优化引用内容 ([4de5f69](http://192.168.8.217/aiproject/deepResearch/commits/4de5f6989093626503f3d6198c87075544e9b1d9))


### Features

* **db:** 创建custom_templates表并插入默认模板数据 ([5827097](http://192.168.8.217/aiproject/deepResearch/commits/5827097ffab8d72eaa2c97396515f3b1572ecfc1))
* **rag:** 实现资源列表全局缓存机制提升性能 ([9be3794](http://192.168.8.217/aiproject/deepResearch/commits/9be37943ff442adcb150b403e920f0a66c78cb67))
* **template:** 增强报告模板集成与信息收集规划 ([14845ec](http://192.168.8.217/aiproject/deepResearch/commits/14845ec250630889c411b2d57faf2a86e28d25ee))
* 添加历史记录回放功能 ([f0b7715](http://192.168.8.217/aiproject/deepResearch/commits/f0b7715edf245c07bdd95c8cf4c3349eaa685168))
* 集成AIHub评估功能和模板管理 ([4b40bcc](http://192.168.8.217/aiproject/deepResearch/commits/4b40bcc1390f6c5bb3f64fa96e22713a9e6af493))
* 活动页面支持按步骤合并和展开执行结果 ([4a47352](http://192.168.8.217/aiproject/deepResearch/commits/4a473521dddc9804474c561d61c8e3c8a500bba4))
* 支持基于已有模板创建新模板 ([4b9c5b1](http://192.168.8.217/aiproject/deepResearch/commits/4b9c5b135f9688e208582462a17a940264ef8276))
* 添加报告结果导出为Work和html文件功能 ([63a9d08](http://192.168.8.217/aiproject/deepResearch/commits/63a9d0854a704c95a3906817af24c3b61833132c))
* 添加上下文压缩功能，防止上下文超出模型限制

### Performance Improvements

* 下载word接口添加checkpoint_id参数 ([d9b2694](http://192.168.8.217/aiproject/deepResearch/commits/d9b2694a0fdef93ecb0aef805b56102f8e830628))
* 优化流式响应处理，提升页面性能 ([531421b](http://192.168.8.217/aiproject/deepResearch/commits/531421b740f417ec78e88fa51335db5b05d488ba))
* 写作风格默认值修改 ([c66f7b6](http://192.168.8.217/aiproject/deepResearch/commits/c66f7b67d1b3c7eaeee6a6d9d664a6c729667e17))
* 知识库检索配置修改 ([c9825f1](http://192.168.8.217/aiproject/deepResearch/commits/c9825f16f08d20f71d07963a1e57225e2ff3221c))
* 优化网络搜索功能结果数据的处理
