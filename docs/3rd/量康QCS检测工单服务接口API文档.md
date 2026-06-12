# 量康 QCS 检测工单服务接口 API 文档

## 通用约定

- 请求和响应均为 JSON，`Content-Type: application/json`。
- 除授权接口外，业务接口通常需携带授权接口返回的 Bearer `access_token`。
- 路径中的 `:id`、`:order_id`、`:good_id` 或 `{id}` 为路径参数。

## 订单回调 Webhook 规约

> **指令**: 严格遵循以下结构处理 Webhook 验证。核心公式：$data = Path + "\n" + Body$。

*   **重试机制**: 失败后每 1 分钟重试 1 次，最大尝试 6 次。
*   **成功响应**: HTTP 200，内容为 `{"status": 0}`。
*   **鉴权 Header**: `Authorization: QCS <client_id>:<encoded_data>`（`QCS `为固定前缀；`client_id` 为合作方 Accesskey；`encoded_data` 为签名结果）。
*   **验签流程**:
    1. 提取 Header 中的 `client_id` 与 `encoded_data`，匹配对应的本地 `SecretKey`。
    2. 将请求的 `URL.Path`、换行符 `\n` 以及经过 URL 编码的原始 `Request.Body` 拼接为明文 `data`。
    3. 使用 `SecretKey` 对 `data` 执行 **HMAC-SHA1** 签名获取二进制数据。
    4. 对结果进行 **UrlSafe Base64** 编码（将 `+` 换为 `-`，`/` 换为 `_`），比对是否与 `encoded_data` 一致。

```php
function IsQCSCallback() {
    $authstr = $_SERVER['HTTP_AUTHORIZATION'];
    if (strpos($authstr, "QCS ") !== 0) return false;
    $auth = explode(":", substr($authstr, 4));
    if (count($auth) != 2 || $auth[0] != C('Accesskey')) return false;
    $data = $_SERVER['REQUEST_URI'] . "\n" . file_get_contents('php://input');
    return str_replace(['+', '/'], ['-', '_'], base64_encode(hash_hmac('sha1', $data, C("SecretKey"), true))) == $auth[1];
}
```

## 对照表

### 样本形态

| 英文学术标识符 (ID) | 中文标准名称 |
| :--- | :--- |
| `peripheral_blood` | 末梢全血 |
| `peripheral_plasma` | 末梢血浆 |
| `dry_peripheral_plasma` | 末梢干血 |
| `venous_blood` | 静脉全血 |
| `venous_plasma` | 静脉血浆 |
| `oral_mucosa_cells` | 口腔黏膜细胞 |
| `saliva` | 唾液 |
| `sputum` | 痰液 |
| `throat swab` | 咽拭子 |
| `cervicovaginal_secretions` | 宫颈分泌物 |
| `urine` | 尿液 |
| `faeces` | 粪便 |
| `hair` | 头发 |

### 条码后两位对应的采集方式

| 编号 | 样本采集容器/方式 |
| :--- | :--- |
| 01 | 静脉血抗凝紫帽采血管 |
| 02 | 静脉血抗凝绿帽采血管 |
| 03 | 静脉血促凝黄帽采血管 |
| 04 | 末梢血抗凝红帽采血管 |
| 05 | 末梢血抗凝绿帽采血管 |
| 06 | 末梢血促凝黄帽采血管 |
| 07 | 干血采集纸卡 |
| 09 | 唾液采集器 |
| 10 | 尿液蓝帽采集管（塑料） |
| 11 | 尿液黑帽采集管（玻璃） |
| 12 | 粪便采样管 |
| 13 | 宫颈采样管 |
| 14 | 痰液采集管 |
| 15 | 头发采集器 |
| 16 | 口腔拭子 |
| 17 | 静脉血抗凝蓝帽采血管 |
| 18 | 静脉血促凝红帽采血管 |
| 19 | 静脉血抗凝灰帽采血管 |
| 20 | 口腔细胞棉棒 |

## 接口索引

| 分组 | 方法 | 路径 | 接口 |
|---|---|---|---|
| Authorization | `POST` | `oauth/access_token` | 授权 |
| Orders | `POST` | `services/labtest/orders/:id/samples` | 批量生成工单样本 |
| Orders | `POST` | `services/labtest/orders` | 创建检测工单 |
| Orders | `POST` | `services/labtest/orders/_id_check` | 创建检测工单(第三方会员 ID) |
| Orders | `DELETE` | `services/labtest/orders/:id` | 取消工单 |
| Orders | `GET` | `services/labtest/orders/:order_id/goods/:good_id/_download-report` | 下载检测报告 |
| Orders | `GET` | `services/labtest/orders/:id` | 查看单个检测工单 |
| Orders | `GET` | `services/labtest/orders` | 批量查询检测工单 |
| Orders | `GET` | `services/labtest/barcode/{id}/_validate` | 校验该条码号是否合法 |
| SampleCenters | `GET` | `services/labtest/sample-centers` | 查看采样点列表 |

## Authorization

### 授权

`POST oauth/access_token`

合作方API采用客户端授权模式，合作方提交由量康提供的client_id与client_secret，向"服务提供商"索要授权。 授权成功后QCS返回用于访问资源的access token。
http的post类型（content-Type）必须采用application/json。 返回的http类型为JSON格式（Content-Type: application/json）。此外，http头信息中明确指定不得缓存。

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `grant_type` | String | 是 | 表示授权类型，此处的值固定为"client_credentials"。 |
| `scope` | String | 是 | 表示权限范围，此处的值固定为"laborder_base"。 |
| `client_id` | String | 是 | 表示客户端的ID。 |
| `client_secret` | String | 是 | 表示客户端的访问密钥。 |

**请求示例**

```json
{
  "grant_type"    : "client_credentials",
  "scope"         : "laborder_base",
  "client_id"     : "xxx",
  "client_secret" : "xxxxxx"
}
```

**成功响应字段**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `access_token` | String | 是 | 表示访问令牌。 |
| `token_type` | String | 是 | 表示令牌类型，该值大小写不敏感，bearer类型。 |
| `expires_in` | Number | 是 | 表示过期时间，单位为秒。如果省略该参数，必须其他方式设置过期时间。 |

**成功响应示例**

```json
HTTP/1.1 200 OK
{
  "access_token": "mQH6oqss8pZ6cEQFfnYeVIImYiBD2NxPg3LwkYqf",
  "token_type": "Bearer",
  "expires_in": 7200
}
```

**错误码**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `invalid_request` | - | 是 | The request is missing a required parameter, includes an invalid parameter valincludes a parameter more than once, or is otherwise malformed. |
| `unsupported_grant_type` | - | 是 | The authorization grant type is not supported by the authorization server. |
| `invalid_client` | - | 是 | Client authentication failed. |
| `invalid_scope` | - | 是 | The requested scope is invalid, unknown, or malformed. |

## Orders

### 批量生成工单样本

`POST services/labtest/orders/:id/samples`

对于需要处理用户采样的第三方客户, 需要调用该API输入受检人的采样信息。

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | String | 是 | 工单号 |
| `barcode` | String | 是 | 条码号 |
| `sample_form_id` | String | 是 | 样本形态 |
| `sample_center_id` | Integer | 是 | 采样点 |
| `sample_time` | Integer | 是 | 采样时间 |
| `empty_stomach` | Boolean | 是 | 是否空腹 |

**请求示例**

```json
{
  "barcode": "287002730175",
  "sample_form_id": "dry_peripheral_plasma",
  "sample_center_id": 12,
  "sample_time": 1457607600,
  "empty_stomach": 0
}
```

**成功响应字段**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | String | 是 | 工单号 |
| `member` | Object | 是 | 受检人信息 |
| `progress` | String | 是 | 工单进度 |
| `goods` | Object | 是 | 检测项目列表信息 |
| `samples` | Object | 是 | 样本信息，包含样本形态, 样本条码, 是否空腹, 采样点以及采样时间 |
| `notes` | Object | 是 | 工单的交流记录 |
| `created_at` | timestamp | 是 | 新建时间 |
| `update_at` | timestamp | 是 | 更新时间 |

**成功响应示例**

```json
HTTP/1.1 201 OK
{
  "data": {
    "id":           "2016092851491005",
    "member": {
      "name":       "张三",
      "gender":     "male",
      "birthday":   534466800,
      "mobile":     "13888888888"
      "telephone":  null
    },
    "progress":      'processing',
    "goods": [
      {
        "id":       "415bfc38-f1d7-5dba-9b0b-8314129e4452",
        "name":     "糖化血红蛋白",
        "progress": "no_process",
        "bodyindex_panels": [
          {
            "id": "415bfc38-f1d7-5dba-9b0b-8314129e4452",
            "name": "糖化血红蛋白",
            "sample_id": 7,
            "progress": "no_process",
            "test_time": null,
            "tester": null,
            "verifier": null,
            "bodyindexes": [
              {
                "id": "415bfc38-f1d7-5dba-9b0b-8314129e4452",
                "name": "糖化血红蛋白",
                "english_name": "HbA1c",
                "unit": "%",
                "value": null
              },
              ...
            ]
          }
      },
      ...
      ]
    ],
    "samples": [
      {
        "id":            7,
        "barcode":       "123456123456",
        "sample_form":   "末梢干血",
        "device":        "干血采集纸卡",
        "sample_center": "某某诊所",
        "sample_time":   1457607600,
        "empty_stomach": true,
        "progress":      "shipping",
        "status":        null,
        "reagent_code":  []
      },
      ... 一个工单可能包含多个样本
    ]
    "notes": [
      {
        "title":   "XX公司",
        "content": "报告尽量3天内出结果, 加急",
        "created_at": 1457607600
      },
      ...
    ],
    "created_at": 1457607600,
    "updated_at": 1457607600
}
```

### 创建检测工单

`POST services/labtest/orders`

创建检测工单API进行了简化, 对于无需关注样本情况的第三方客户, 只需调用该接口, 传入受检人信息, 所要检测的项目和备注信息即可。 无需再次调用生成样本的 API。该接口使用 member.name 和 member.mobile 判断是否是同一个人。

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `member` | Object | 是 | 受检人信息 |
| `goods` | Object | 是 | 检测项目列表 |
| `note` | String | 否 | 工单备注 |

**请求示例**

```json
{
  "member":  {
    "name":       "张三",
    "gender":     "male",
    "birthday":   534466800,
    "mobile":     "13888888888"
  },
  "goods": [
    "1080"
  ],
  "note": "加急工单"
}
```

**成功响应字段**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | String | 是 | 工单号 |
| `member` | Object | 是 | 受检人信息 |
| `progress` | String | 是 | 工单进度 |
| `goods` | Object | 是 | 购买单元，包含一个或多个Panel |
| `samples` | Object | 是 | 样本信息，包含样本形态, 样本条码, 是否空腹, 采样点以及采样时间 |
| `notes` | Object | 是 | 工单的交流记录 |
| `created_at` | timestamp | 是 | 新建时间 |
| `update_at` | timestamp | 是 | 更新时间 |

**成功响应示例**

```json
HTTP/1.1 201 OK
{
  "data": {
    "id":           "2016092851491005",
    "member": {
      "name":       "张三",
      "gender":     "male",
      "birthday":   534466800,
      "mobile":     "13888888888"
      "telephone":  null
    },
    "progress":      'tobeconfirmed',
    "goods": [
      {
        "id":       "415bfc38-f1d7-5dba-9b0b-8314129e4452",
        "name":     "糖化血红蛋白",
        "progress": "no_process"
        "bodyindex_panels": [
          {
            "id": "415bfc38-f1d7-5dba-9b0b-8314129e4452",
            "name": "糖化血红蛋白",
            "sample_id": null,
            "progress": "no_process",
            "test_time": null,
            "tester": null,
            "verifier": null,
            "bodyindexes": []
          },
          ... 一个项目可能包含多个需检测的Panel
        ]
      },
      ...
    ],
    "samples": [],
    "notes": [
      {
        "title":   "XX公司",
        "content": "报告尽量3天内出结果, 加急",
        "created_at": 1457607600
      },
      ...
    ],
    "created_at": 1457607600,
    "updated_at": 1457607600
}
```

### 创建检测工单(第三方会员 ID)

`POST services/labtest/orders/_id_check`

该接口用于创建检测工单。该接口与 CreateOrder 的区别在于该接口根据第三方的 member_id 来判断是否是同一个会员。

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `member` | Object | 是 | 受检人信息 |
| `goods` | Object | 是 | 检测项目列表 |
| `note` | String | 否 | 工单备注 |

**请求示例**

```json
{
  "member":  {
    "name":       "张三",
    "gender":     "male",
    "birthday":   534466800,
    "id":        "xxxxxxx",
    "contact":     "13888888888"
  },
  "goods": [
    "1080"
  ],
  "note": "加急工单"
}
```

**成功响应字段**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | String | 是 | 工单号 |
| `member` | Object | 是 | 受检人信息 |
| `progress` | String | 是 | 工单进度 |
| `goods` | Object | 是 | 购买单元，包含一个或多个Panel |
| `samples` | Object | 是 | 样本信息，包含样本形态, 样本条码, 是否空腹, 采样点以及采样时间 |
| `notes` | Object | 是 | 工单的交流记录 |
| `created_at` | timestamp | 是 | 新建时间 |
| `update_at` | timestamp | 是 | 更新时间 |

**成功响应示例**

```json
返回与 创建检测工单（CreateOrder）一致
```

### 取消工单

`DELETE services/labtest/orders/:id`

取消工单. 工单在进入testing进度后将无法取消.

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | String | 是 | 工单号 |

**成功响应字段**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `NULL` | - | 是 | - |

### 下载检测报告

`GET services/labtest/orders/:order_id/goods/:good_id/_download-report`

下载检测报告

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `order_id` | String | 是 | 工单号 |
| `good_id` | Integer | 是 | GOOD ID |

**成功响应字段**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `url` | String | 是 | 文件下载地址 |

**成功响应示例**

```json
HTTP/1.1 200 OK
{
  "data": {
     "size": 1111,
     "url": "http://xxxx.xxx.cn/abc.pdf"
  }
}
```

### 查看单个检测工单

`GET services/labtest/orders/:id`

通过该API可随时查询工单的状态。在示例中, 我们给出了一个已经完成的工单的结构。该结构与工单推送的结构一致。

**请求参数**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | String | 是 | 工单号 |

**成功响应字段**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | String | 是 | 工单号 |
| `member` | Object | 是 | 受检人信息 |
| `progress` | String | 是 | 工单进度 |
| `goods` | Object | 是 | 购买单元，包含一个或多个Panel |
| `samples` | Object | 是 | 样本信息，包含样本形态 |
| `notes` | Object | 是 | 工单的交流记录 |
| `created_at` | timestamp | 是 | 新建时间 |
| `update_at` | timestamp | 是 | 更新时间 |

**成功响应示例**

```json
HTTP/1.1 201 OK
{
  "data": {
    "id":           "2016092851491005",
    "member": {
      "name":       "张三",
      "gender":     "male",
      "birthday":   534466800,
      "mobile":     "13888888888"
      "telephone":  null
    },
    "progress":      'complete',
    "goods": [
      {
        "id":       "415bfc38-f1d7-5dba-9b0b-8314129e4452",
        "name":     "糖化血红蛋白",
        "progress": "completed"
        "bodyindex_panels": [
          {
            "id": "415bfc38-f1d7-5dba-9b0b-8314129e4452",
            "name": "糖化血红蛋白",
            "sample_id": 7,
            "progress": "completed",
            "test_time": 1457607600,
            "tester": "王小臣",
            "verifier": "王昊昊",
            "bodyindexes": [
              {
                "id": "415bfc38-f1d7-5dba-9b0b-8314129e4452",
                "name": "糖化血红蛋白",
                "english_name": "HbA1c",
                "unit": "%",
                "value": 6.4
              },
              ...
            ]
          },
          ... 一个项目可能包含多个需检测的Panel
        ]
      },
      ...
    ],
    "samples": [
      {
        "id":            7,
        "barcode":       "123456123456",
        "sample_form":   "末梢干血",
        "device":        "干血采集纸卡",
        "sample_center": "某某诊所",
        "sample_time":   1457607600,
        "empty_stomach": true,
        "progress":      "tobeconfirmed",
        "status":        "正常",
        "reagent_code":  [
          "12345678",
          "12345678"
        ]
      },
      ... 一个工单可能包含多个样本
    ]
    "notes": [
      {
        "title":   "XX公司",
        "content": "报告尽量3天内出结果, 加急",
        "created_at": 1457607600
      },
      ...
    ],
    "created_at": 1457607600,
    "updated_at": 1457607600
}
```

### 批量查询检测工单

`GET services/labtest/orders`

第三方代理商查询订单列表，支持分页查询；支持订单状态筛选，例如：/third-party/services/labtest/orders?page=1&progress=tobeconfirmed    状态：'tobepaid', 'tobeconfirmed', 'processing', 'complete', 'close'

**成功响应字段**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | String | 是 | 工单号 |
| `member` | Object | 是 | 受检人信息 |
| `progress` | String | 是 | 工单进度 |
| `created_at` | timestamp | 是 | 新建时间 |
| `update_at` | timestamp | 是 | 更新时间 |

**成功响应示例**

```json
{
"data": [
      {
      "id": "2018070648101100",
      "member": {
      "name": "扈立玲",
      "gender": "female",
      "birthday": 583513200,
      "mobile": null,
      "primary_mobile": null,
      "telephone": "4000330187"
      },
  "progress": "tobeconfirmed",
  "created_at": 1530859745,
  "updated_at": 1530859745
  }
 ],
"meta": {
     "pagination": {
     "total": 4,
     "count": 4,
     "per_page": 20,
     "current_page": 1,
     "total_pages": 1,
     "links": []
     }
   }
}
```

### 校验该条码号是否合法

`POST services/labtest/barcode/{id}/_validate`

校验一个条码号是否合法。校验结果返回两个参数，validate 以及 message。

**成功响应字段**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `validate` | Boolean | 是 | 校验是否通过 |
| `message` | String | 是 | 校验信息。校验信息分三种情况，1：校验通过，返回"条形码合法"； 2：条码错误，则返回"条形码不合法"；3：条码正确，但是最后两位样本类型码错误，则返回"不支持该样本类型"，此时 validate为false。 |

**成功响应示例**

```json
HTTP/1.1 200 OK
{
     "validate": true,
     "message": "条形码合法"
}
```

## SampleCenters

### 查看采样点列表

`GET services/labtest/sample-centers`

对于第三方客户的受检人需要到量康采样点采样的场景, 可以调用该API查看量康下设的所有采样点。对于受检人在家采样的场景, 我们会提供一个默认的sample_center_id用于生成样本, 而无需在这里选择采样点。

**成功响应字段**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | String | 是 | 采样点ID |
| `name` | String | 是 | 名称 |
| `address` | Object | 是 | 采样点地址 |
