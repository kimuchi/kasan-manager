# API リファレンス

## @cpos/types

全パッケージの基盤となる型定義。ランタイム依存ゼロ。

### ケアプラン

```typescript
interface CareplanData {
  user_profile: UserProfile;
  assessment: Assessment | null;
  documents: Documents;
}

interface Documents {
  table_1?: Table1 | null;       // 第1表: 基本情報・援助方針
  table_2?: Table2Item[] | null; // 第2表: ニーズ・目標・サービス
  table_3?: Table3 | null;       // 第3表: 週間スケジュール
  table_4?: Table4 | null;       // 第4表: 担当者会議
  table_5?: Table5Item[] | null; // 第5表: 支援経過
  table_6_7?: Table67 | null;    // 第6・7表: 利用票・別表
}
```

### 利用者・事業者・従業員

```typescript
interface Patient {
  id: string; name: string; nameKana?: string | null;
  gender?: string | null; birthDate?: string | null;
  careLevel?: string | null; insuredNumber?: string | null;
  insurerNumber?: string | null; active: boolean;
  organizationId: string;
}

interface Provider {
  id: string; name: string; providerNumber: string;
  serviceTypeCode?: string | null; organizationId: string;
}

interface Employee {
  id: string; name: string; role: string;
  qualifications?: string[]; active: boolean;
  organizationId: string;
}
```

### 記録・バイタル・臨床

```typescript
interface DailyRecord {
  id: string; patientId: string; date: string;
  recordType: string; content: string;
  staffName?: string | null; organizationId: string;
}

interface VisitRecord {
  id: string; patientId: string; visitDate: string;
  startTime: string; endTime: string; serviceType: string;
  subjective?: string | null; objective?: string | null;
  assessment?: string | null; plan?: string | null;
  temperature?: number | null; bpSystolic?: number | null;
  bpDiastolic?: number | null; pulseRate?: number | null;
  spo2?: number | null; organizationId: string;
}

interface VitalSign {
  id: string; patientId: string; date: string; time: string;
  temperature?: number | null; bpSystolic?: number | null;
  bpDiastolic?: number | null; pulseRate?: number | null;
  spo2?: number | null; respirationRate?: number | null;
  weight?: number | null; organizationId: string;
}

interface MonitoringRecord {
  id: string; patientId: string; date: string;
  shortTermGoal: string; achievement: string;
  status: string; needChange: boolean;
  organizationId: string;
}

interface ImportantNote {
  id: string; patientId: string;
  category: ImportantNoteCategory; // 'allergy' | 'contraindication' | 'infection' | ...
  content: string; severity: 'critical' | 'warning' | 'info';
  organizationId: string;
}

interface ProgressNote {
  id: string; patientId: string; date: string;
  category: string; content: string; source: string;
  staffName?: string | null; organizationId: string;
}
```

### 統合記録（Single Entry, Multiple Exit）

```typescript
type RecordClassification = 'audit' | 'service';
type ExecutionMarker = 'complete' | 'partial' | 'observation';  // ○ △ ◇

type RecordType =
  | 'care_meeting' | 'home_visit' | 'nursing_visit'
  | 'day_service' | 'monitoring_visit' | 'assessment_visit'
  | 'phone_contact' | 'other';

type RoutingTarget = 'assessment' | 'basic_info' | 'report' | 'communication';

type RecordItemCategory =
  | 'medical_history' | 'life_history' | 'needs' | 'satisfaction'
  | 'family_info' | 'bp_range' | 'existing_services'
  | 'service_content' | 'service_result' | 'observation'
  | 'agreement' | 'communication_nurse' | 'communication_cm' | 'other';

interface RecordEntry {
  id: string; patientId: string; date: string;
  recordType: RecordType;
  classification: RecordClassification;   // audit=非算定, service=算定
  isBillable: boolean;
  items: RecordItem[];                    // 構造化入力項目
  vitals?: RecordVitals | null;
  meeting?: MeetingDetails | null;        // 担当者会議
  service?: ServiceDetails | null;        // 訪問サービス
  executionMarker?: ExecutionMarker | null;
  isImmutable: boolean;                   // 監査ログ用
  organizationId: string;
}

interface RecordItem {
  field: string; value: string;
  category: RecordItemCategory;
  routeTo: RoutingTarget[];               // 自動ルーティング先
}

interface RoutingResult {
  recordId: string;
  assessmentUpdates: AssessmentUpdate[];   // → アセスメント
  basicInfoUpdates: BasicInfoUpdate[];     // → 基本情報マスタ
  reportEntries: ReportEntry[];            // → 報告書
  communicationNotes: CommunicationNote[]; // → 他職種連絡
}
```

### ユーザー・グループ・権限

```typescript
type UserRole =
  | 'admin' | 'manager' | 'staff' | 'viewer'
  // 臨床ロール (権限レベルは staff 同等、表示分類用)
  | 'nurse' | 'physical_therapist' | 'occupational_therapist' | 'speech_therapist';

type LicenseType =
  | 'nurse' | 'public_health_nurse' | 'midwife'
  | 'physical_therapist' | 'occupational_therapist' | 'speech_therapist';

interface User {
  id: string; email: string; name: string; nameKana?: string | null;
  picture?: string | null; role: UserRole;
  licenseType?: LicenseType | null; licenseNumber?: string | null;
  groupIds: string[]; allowedAppIds: string[];
  preferences: UserPreferences; isActive: boolean;
  lastLoginAt?: string | null; organizationId: string;
  createdAt: string; updatedAt: string;
}

interface UserPreferences {
  dashboardLayout?: DashboardWidget[];
  appOrder?: string[];           // アプリ表示順
  hiddenAppIds?: string[];       // 非表示アプリ
  theme?: 'light' | 'dark' | 'system';
  locale?: string;
}

interface Group {
  id: string; name: string; description?: string | null;
  allowedAppIds: string[];
  permissions: Permission[];
  organizationId: string;
  createdAt: string; updatedAt: string;
}

type PermissionAction = 'read' | 'write' | 'delete' | 'deploy' | 'admin';

interface Permission {
  resource: string;
  actions: PermissionAction[];
}

interface AppRegistration {
  id: string; name: string; description: string;
  type: 'fullstack' | 'api' | 'worker';
  icon?: string | null; url?: string | null;
  manifestPath?: string | null;
  isPublic: boolean;
  requiredPermissions: Permission[];
  organizationId: string; createdAt: string;
}

interface AuthSession {
  userId: string; email: string; name: string;
  role: UserRole;
  capabilities?: UserCapability[];
  /** 医療資格 (`User.licenseType` のミラー)。臨床アプリで自動入力等に使用 */
  licenseType?: LicenseType | null;
  licenseNumber?: string | null;
  accessToken: string;
  refreshToken?: string | null; expiresAt: string;
  allowedAppIds: string[];     // マージ済み
  permissions: Permission[];    // マージ済み
}
```

### コネクタインターフェース

```typescript
type DocumentFormat = 'json' | 'csv' | 'pdf' | 'excel' | 'sheets' | 'sql' | 'gdoc';
type DocumentType = 'careplan' | 'assessment' | 'daily_record' | 'visit_record'
  | 'vital_sign' | 'monitoring' | 'important_note' | 'facesheet' | 'inbox';

interface DocumentReader<T> {
  readonly format: DocumentFormat;
  read(id: string): Promise<T | null>;
  list(query?: DocumentQuery): Promise<DocumentEntry[]>;
}

interface DocumentWriter<T> {
  readonly format: DocumentFormat;
  write(data: T, options?: { id?: string; patientId?: string }): Promise<WriteResult>;
}

interface DocumentExporter<T> {
  readonly format: DocumentFormat;
  export(data: T, options?: Record<string, unknown>): Promise<ExportResult>;
}

interface DocumentConnector<T> extends DocumentReader<T>, DocumentWriter<T> {
  delete(id: string): Promise<void>;
}
```

---

## @cpos/core

I/O依存ゼロの純粋関数群。

### 日付変換

```typescript
parseDateToYYYYMMDD(dateStr: string | null): string
// '令和2年12月1日' → '20201201'
// 'R2.12.1' → '20201201'
// '2020/12/01' → '20201201'

parseMonthToYYYYMM(monthStr: string | null): string
yyyymmddToWareki(yyyymmdd: string): string   // '20201201' → '令和2年12月1日'
nowTimestamp(): string                        // → '20260422143025'
dateToYYYYMMDD(date: Date): string
dateToISO(date: Date): string
```

### 介護コード変換

```typescript
careLevelToCode(careLevel: string | null): string      // '要介護2' → '22'
codeToCareLevelText(code: string): string               // '22' → '要介護2'
CARE_LEVEL_LIMIT_UNITS: Record<string, number>          // 支給限度単位数
serviceTypeToCode(serviceType: string | null): string   // '訪問看護' → '13'
codeToServiceTypeName(code: string): string
```

### 名前処理

```typescript
sanitizeName(name: string | null): string
normalizeName(name: string): string
splitName(fullName: string | null): { sei: string; mei: string }
toHalfWidth(str: string): string
hiraganaToKatakana(str: string | null): string
katakanaToHiragana(str: string | null): string
genderToCode(gender: string | null): string
matchName(candidate: string, target: string): boolean   // 異体字対応
findBestMatch(target: string, candidates: string[]): string | null
```

### 期間フォルダ

```typescript
parsePeriodFolderName(name: string): PeriodFolderInfo | null
buildPeriodFolderName(planDate, certStart, careLevel, category): string
shouldMergePeriods(folderA: string, folderB: string): boolean  // 93日以内
```

### 記録ルーティング

```typescript
routeRecord(record: RecordEntry, customRules?: RoutingRule[]): RoutingResult
// 記録入力を自動ルーティングし、各出口へのデータを生成

classifyRecordType(recordType: RecordType): RecordClassification
// 'home_visit' → 'service', 'care_meeting' → 'audit'

isBillableByDefault(recordType: RecordType): boolean
// サービス種別から算定対象かを判定

resolveRoutingTargets(category: RecordItemCategory, rules?: RoutingRule[]): RoutingTarget[]
// 入力項目カテゴリからルーティング先を解決

getDefaultRoutingRules(): RoutingRule[]
// デフォルトルーティングルール一覧

markerToSymbol(marker: ExecutionMarker): string   // 'complete' → '○'
markerToLabel(marker: ExecutionMarker): string     // 'complete' → '実施完了'
symbolToMarker(symbol: string): ExecutionMarker | null  // '○' → 'complete'
```

### Result パターン

```typescript
ok<T>(data: T): Result<T, never>
err<E>(error: E): Result<never, E>
isOk(result): boolean
isErr(result): boolean
unwrap(result): T
```

---

## @cpos/io

ストレージ抽象化・永続化・エンコーディング。

### FileStorage

```typescript
interface FileStorage {
  listFolders(parentId: string): Promise<FolderEntry[]>
  listFiles(folderId: string, query?: string, mimeType?: string): Promise<FileEntry[]>
  readFile(fileId: string): Promise<string>
  readFileAsBuffer(fileId: string): Promise<Buffer>
  writeFile(folderId: string, name: string, content: string | Buffer, mimeType?: string): Promise<FileEntry>
  findSubFolder(parentId: string, folderName: string): Promise<string | null>
  createFolder(parentId: string, folderName: string): Promise<FolderEntry>
  moveFile(fileId: string, targetFolderId: string): Promise<void>
  deleteFile(fileId: string): Promise<void>
  /** 既存ファイルを別名/別フォルダに複製 (テンプレ運用用) */
  copyFile?(fileId: string, opts: { name: string; parentId?: string }): Promise<{ id: string; webViewLink?: string }>
}

// 実装
new GoogleDriveStorage(accessToken: string)
new LocalFileStorage()
```

### CloudStorageAdapter (オブジェクトストレージ抽象)

Drive とは別の、バイナリ用オブジェクトストレージ。生成 PDF / レポート等の保管に。
プロバイダ非依存 (GCS / S3 / MinIO 等を差し替え可能)。

```typescript
interface CloudStorageAdapter {
  upload(bucket: string, path: string, data: Buffer, contentType?: string): Promise<void>
  signedUrl(bucket: string, path: string, expiresInSec: number): Promise<string>
  delete(bucket: string, path: string): Promise<void>
  download?(bucket: string, path: string): Promise<Buffer>  // optional
}

// 実装 (Google Cloud Storage)
new GoogleCloudStorageAdapter({
  accessToken?: string,        // OAuth セッション越し
  projectId?: string,          // ADC (Cloud Run service account) 利用時
  defaultSignedUrlExpiresSec?: number   // 既定 3600
})
```

### DocumentStorage (Google Docs抽象化)

```typescript
interface DocumentStorage {
  readDocument(documentId: string): Promise<RichTextDocument>
  createDocument(title: string, body: string, parentFolderId?: string): Promise<RichTextDocument>
  updateDocument(documentId: string, body: string): Promise<void>
  appendToDocument(documentId: string, text: string): Promise<void>
}

// 実装
new GoogleDocsStorage(accessToken: string)
```

### マスタ Repository

```typescript
interface ProviderRepository {
  findAll(): Promise<Provider[]>
  findByName(name: string): Promise<Provider | null>
  findByNumber(providerNumber: string): Promise<Provider | null>
  save(provider: ...): Promise<Provider>
  delete(id: string): Promise<void>
}

interface PatientRepository {
  findAll(options?: { activeOnly?: boolean }): Promise<Patient[]>
  findById(id: string): Promise<Patient | null>
  findByName(name: string): Promise<Patient | null>
  findSummaries(options?: { activeOnly?: boolean }): Promise<PatientSummary[]>
  save(patient: ...): Promise<Patient>
  delete(id: string): Promise<void>
}

interface EmployeeRepository {
  findAll(options?: { activeOnly?: boolean }): Promise<Employee[]>
  findById(id: string): Promise<Employee | null>
  findSummaries(options?: { activeOnly?: boolean }): Promise<EmployeeSummary[]>
  save(employee: ...): Promise<Employee>
  delete(id: string): Promise<void>
}

interface SettingsRepository {
  get(organizationId: string): Promise<OrganizationSettings | null>
  save(organizationId: string, settings: OrganizationSettings): Promise<void>
}

// Sheets実装
new SheetsProviderRepository(sheets, spreadsheetId)
new SheetsPatientRepository(sheets, spreadsheetId)
new SheetsSettingsRepository(sheets, spreadsheetId)
```

### 記録・臨床 Repository

```typescript
interface DailyRecordRepository {
  findByPatient(patientId: string, options?: { dateFrom?; dateTo?; limit? }): Promise<DailyRecord[]>
  findById(id: string): Promise<DailyRecord | null>
  save(record: ...): Promise<DailyRecord>
  delete(id: string): Promise<void>
}

interface VisitRecordRepository {
  findByPatient(patientId: string, options?: { dateFrom?; dateTo?; limit? }): Promise<VisitRecord[]>
  findById(id: string): Promise<VisitRecord | null>
  save(record: ...): Promise<VisitRecord>
  delete(id: string): Promise<void>
}

interface VitalSignRepository {
  findByPatient(patientId: string, options?: { dateFrom?; dateTo?; limit? }): Promise<VitalSign[]>
  findLatest(patientId: string): Promise<VitalSign | null>
  save(vital: ...): Promise<VitalSign>
  delete(id: string): Promise<void>
}

interface MonitoringRepository {
  findByPatient(patientId: string, options?: { dateFrom?; dateTo? }): Promise<MonitoringRecord[]>
  save(record: ...): Promise<MonitoringRecord>
  delete(id: string): Promise<void>
}

interface ImportantNoteRepository {
  findByPatient(patientId: string, options?: { category?; activeOnly? }): Promise<ImportantNote[]>
  save(note: ...): Promise<ImportantNote>
  delete(id: string): Promise<void>
}

interface FacesheetRepository {
  get(patientId: string): Promise<FacesheetData | null>
  save(patientId: string, data: FacesheetData): Promise<void>
  addInboxEntry(patientId: string, entry: InboxEntry): Promise<void>
  getInbox(patientId: string, options?: { limit? }): Promise<InboxEntry[]>
}

interface ProgressNoteRepository {
  findByPatient(patientId: string, options?: {
    dateFrom?; dateTo?; category?; limit?;
    order?: 'newest' | 'oldest'   // デフォルト: newest
  }): Promise<ProgressNote[]>
  append(note: Omit<ProgressNote, 'id'>): Promise<ProgressNote>
  delete(id: string): Promise<void>
}

// Google Docs実装
new GDocProgressNoteRepository(docs: DocumentStorage, fileStorage: FileStorage)
```

### 統合記録 Repository（Single Entry, Multiple Exit）

```typescript
interface RecordEntryRepository {
  findByPatient(patientId: string, options?: {
    dateFrom?; dateTo?;
    classification?: RecordClassification;  // 'audit' | 'service'
    recordType?: RecordType;
    billableOnly?: boolean;
    limit?; order?: 'newest' | 'oldest';
  }): Promise<RecordEntry[]>
  findById(id: string): Promise<RecordEntry | null>
  save(record: ...): Promise<RecordEntry>
  delete(id: string): Promise<void>
  getAuditLog(recordId: string): Promise<RecordAuditLogEntry[]>
}

interface RecordDispatcher {
  dispatch(record: RecordEntry): Promise<RoutingResult>
  // 記録を受け取り、ルーティングエンジン経由で各出口へ自動配信
}

interface CommunicationNoteRepository {
  findByRecipient(role: string, options?: { unreadOnly?; dateFrom?; dateTo?; limit? }): Promise<CommunicationNote[]>
  findByPatient(patientId: string, options?: { limit? }): Promise<CommunicationNote[]>
  markAsRead(noteId: string): Promise<void>
  save(note: CommunicationNote): Promise<void>
}
```

### ユーザー・グループ・アプリ Repository

```typescript
interface UserRepository {
  findAll(options?: { activeOnly?: boolean; role?: UserRole }): Promise<User[]>
  findById(id: string): Promise<User | null>
  findByEmail(email: string): Promise<User | null>
  save(user: ...): Promise<User>
  updatePreferences(userId: string, preferences: Partial<UserPreferences>): Promise<void>
  delete(id: string): Promise<void>
}

interface GroupRepository {
  findAll(): Promise<Group[]>
  findById(id: string): Promise<Group | null>
  findByUser(userId: string): Promise<Group[]>
  save(group: ...): Promise<Group>
  addUser(groupId: string, userId: string): Promise<void>
  removeUser(groupId: string, userId: string): Promise<void>
  delete(id: string): Promise<void>
}

interface AppRegistrationRepository {
  findAll(options?: { publicOnly?: boolean }): Promise<AppRegistration[]>
  findById(id: string): Promise<AppRegistration | null>
  findAccessibleByUser(userId: string): Promise<AppRegistration[]>
  save(app: ...): Promise<AppRegistration>
  delete(id: string): Promise<void>
}
```

### プロンプト Repository

```typescript
interface PromptRepository {
  findAll(options?: { category?: PromptCategory; activeOnly?: boolean }): Promise<PromptTemplate[]>
  findById(id: string): Promise<PromptTemplate | null>
  save(template: ...): Promise<PromptTemplate>
  delete(id: string): Promise<void>
}
```

### エンコーディング

```typescript
encodeToShiftJIS(utf8Text: string): Buffer
decodeFromShiftJIS(buffer: Buffer): string
rowsToCsvText(rows: string[][]): string
packageToZip(files: Array<{ name: string; content: Buffer }>): Promise<Buffer>
```

---

## @cpos/connectors

フォーマット別の読み書きコネクタ。

### JsonFileStore

```typescript
const store = new JsonFileStore<CareplanData>({
  storage: fileStorage,        // FileStorage実装
  baseFolderId: 'FOLDER_ID',
  documentType: 'careplan',
  filePrefix: 'ケアプラン',
});

await store.read(fileId);            // → CareplanData | null
await store.list({ patientId });     // → DocumentEntry[]
await store.write(data);             // → WriteResult
await store.delete(fileId);
```

### SheetsDocumentStore

```typescript
const store = new SheetsDocumentStore<Record<string, unknown>>({
  sheets: sheetsStorage,
  spreadsheetId: 'SHEET_ID',
  sheetName: 'データ',
  documentType: 'daily_record',
  columns: [
    { key: 'date', column: 'A' },
    { key: 'content', column: 'B' },
    { key: 'vitals', column: 'C', type: 'json' },
  ],
});
```

### SqlDocumentStore

```typescript
const store = new SqlDocumentStore<CareplanData>({
  connection: dbConnection,    // SqlConnection実装
  tableName: 'careplans',
  documentType: 'careplan',
  jsonColumn: 'data',         // JSONカラムモード
});
// または columns で個別カラムマッピング
```

### GDocStore (Google Docs)

```typescript
const store = new GDocStore({
  docs: docsStorage,           // DocumentStorage実装
  documentType: 'daily_record',
  parentFolderId: 'FOLDER_ID',
});

await store.read(docId);      // → テキスト内容
await store.write(text);      // → 新規ドキュメント作成
await store.write(text, { id: docId }); // → 既存ドキュメント更新
```

### PdfDocumentReader

```typescript
const reader = new PdfDocumentReader<CareplanData>({
  storage: fileStorage,
  aiProvider: geminiProvider,
  documentType: 'careplan',
  parseResponse: (raw) => raw as CareplanData,
});

await reader.read(fileId);    // → PDF→AI解析→構造化データ
```

### CareplanCsvExporter

```typescript
const exporter = new CareplanCsvExporter();
const result = await exporter.export(careplanData, {
  csvTypes: ['UPHOSOKU', 'UP1KYO', 'UP2KYO'],
  context: csvGenerationContext,
});
// result.content: Buffer (ZIP or CSV), result.mimeType, result.fileName
```

### ConnectorRegistry

```typescript
const registry = new ConnectorRegistry();
registry.registerReader('careplan', 'json', jsonStore);
registry.registerWriter('careplan', 'json', jsonStore);
registry.registerExporter('careplan', 'csv', csvExporter);
registry.registerReader('careplan', 'pdf', pdfReader);

const reader = registry.getReader<CareplanData>('careplan', 'json');
const formats = registry.listFormats('careplan');
// → { readers: ['json', 'pdf'], writers: ['json'], exporters: ['csv'] }
```

---

## @cpos/ai

```typescript
interface AiProvider {
  generateText(prompt: string): Promise<AiTextResult>
  generateJson<T>(prompt: string): Promise<T>
  analyzeDocument(document: Buffer, mimeType: string, prompt: string): Promise<AiTextResult>
}

new GeminiProvider({ apiKey: string, model?: string })

analyzeDocument(provider, document, mimeType, customPrompt?): Promise<AnalysisResult>
generateCareplanDraft(provider, input): Promise<CareplanDraft>
```

### プロンプトテンプレート管理

```typescript
// 組み込みプロンプト定数
FILING_ANALYSIS_PROMPT: string          // 書類統合解析
TEXT_ANALYSIS_PROMPT: string            // テキスト入力解析
RECORD_ROUTING_PROMPT: string           // 記録ルーティング

// ビルダー関数（変数を受け取ってプロンプトを生成）
buildCareplanGenerationPrompt(context): string
buildTextAnalysisPrompt({ text, patientName? }): string
buildRecordRoutingPrompt({ text, recordType, patientName? }): string
buildReportGenerationPrompt({ patientName, period, records, vitalsHistory? }): string

// レジストリ（プロンプトの登録・検索・上書き・変数解決）
const registry = createPromptRegistry()
registry.get(id): PromptTemplate | null
registry.getByCategory(category): PromptTemplate[]
registry.listAll(): PromptTemplate[]
registry.listActive(): PromptTemplate[]
registry.override(id, content): void          // 組み込みの内容を上書き
registry.register(template): void             // カスタムテンプレートを追加
registry.resolve(id, variables): string        // 変数を埋め込んで完成テキスト取得
```

### プロンプト責任分担

| OS側（@cpos/ai）に置くもの | アプリ側に残すもの |
|---------------------------|-------------------|
| 書類解析プロンプト | GAS固有のUI生成テキスト |
| ケアプラン生成プロンプト | 特定ワークフロー向けカスタム |
| テキスト入力解析プロンプト | アプリ固有のシステムプロンプト |
| 記録ルーティングプロンプト | |
| 報告書生成プロンプト | |

事業所ごとの調整は管理コンソールの「プロンプト管理」画面で行い、`PromptRepository` に永続化。

## @cpos/csv-builders

```typescript
buildAllCsv(csvTypes: CsvType[], careplan, context): { results: BuildResult[]; warnings: string[] }
buildCsvFilename(csvType: CsvType, context: CsvGenerationContext): string

// 個別ビルダー
buildUphosoku(careplan, context): string[][]   // 利用者補足情報
buildUp1kyo(careplan, context): string[][]     // 第1表
buildUp2kyo(careplan, context): string[][]     // 第2表
buildUp3kyo(careplan, context): string[][]     // 第3表
buildUp6kyo(careplan, context): string[][]     // 第6表
buildUp7kyo(careplan, context): string[][]     // 第7表
```

## @cpos/filing

```typescript
classifyDocumentType(filename: string): DocumentType
determineFolderName(documentType: DocumentType): string
matchPatient(userName: string, candidates: PatientCandidate[]): PatientCandidate | null
resolveFilingDestination(ctx: FilingContext, filing: FilingMetadata): Promise<FilingDecision>
```

## @cpos/careplan

```typescript
readCareplanFromStorage(storage: FileStorage, periodFolderId): Promise<CareplanData | null>
readCareplanWithFacesheet(storage, userFolderId, periodFolderId): Promise<CareplanData | null>
saveCareplanToStorage(storage, periodFolderId, careplan, options?): Promise<string>
deepMerge<T>(base: T, overlay: Partial<T>): T
deepMergePreferNonNull(base, overlay): object
parseJaDateToDate(s: string | null): Date | null
```

## @cpos/app-runtime

アプリケーション共通基盤（Express ブートストラップ・認証・権限）。

### アプリ起動

```typescript
import express from 'express';
import { createApp } from '@cpos/app-runtime';

const { app, start } = await createApp(express, {
  name: 'my-app',
  port: Number(process.env.PORT) || 3100,
  routes: [
    { path: '/patients', router: patientsRouter },
  ],
  staticDir: './dist/client',
  onReady: (ctx) => console.log(`Ready at ${ctx.baseUrl}`),
});
await start();
```

### 認証ミドルウェア

```typescript
import {
  requireAuth,
  requireRole,
  requireMinRoleMiddleware,
  requirePermission
} from '@cpos/app-runtime';

router.get('/data', requireAuth('my-app'), handler);              // 認証 + アプリアクセス権
router.post('/deploy', requireRole('admin'), handler);             // admin ロール必須 (階層判定)
router.post('/admin', requireMinRoleMiddleware('admin'), handler); // ↑ と同一。命名を関数版に揃えた alias
router.delete('/records/:id', requirePermission('records', 'delete'), handler);
```

> `requireRole` と `requireMinRoleMiddleware` は実装が同じ。
> 純粋関数版 `requireMinRole(session, minRole)` に名前を揃えたい場合は後者を使う。

### 権限チェック関数

```typescript
import {
  hasPermission, canAccessApp, canDeploy,
  hasRole, meetsMinRole, requireMinRole
} from '@cpos/app-runtime';

// 階層判定
hasRole(session, 'manager')              // session.role が manager 以上か
meetsMinRole(session, 'staff')           // session が null 許容、staff 以上か
requireMinRole(session, 'staff')         // → { ok: true } | { ok: false; status: 401|403; error }

hasPermission(session, 'patients', 'write'): boolean   // admin は常に true
canAccessApp(session, 'csv-export'): boolean            // admin は常に true
canDeploy(session): boolean                             // admin or apps:deploy
hasRole(session, 'manager'): boolean                    // manager 以上か
```

### 権限マージ

```typescript
import { mergePermissions, mergeAllowedApps } from '@cpos/app-runtime';

mergePermissions(userPerms, groupPerms): Permission[]
// リソース単位で actions を Set 合算

mergeAllowedApps(userApps, groupApps, hiddenApps): string[]
// ユーザー + グループの和集合から非表示を除外
```

### 認証プロバイダ・セッションストア

```typescript
interface AuthProvider {
  createAuthUrl(redirectUri: string): string
  exchangeCode(code: string, redirectUri: string): Promise<{ accessToken; refreshToken?; expiresAt }>
  getUserInfo(accessToken: string): Promise<{ email; name; picture? }>
  refreshAccessToken(refreshToken: string): Promise<{ accessToken; expiresAt }>
}

interface SessionStore {
  get(sessionId: string): Promise<AuthSession | null>
  set(sessionId: string, session: AuthSession, ttlSeconds?: number): Promise<void>
  delete(sessionId: string): Promise<void>
}
```

---

## @cpos/alert

```typescript
scanExpirations(items: ExpirationCheckable[], alertType, entityType, options?): AlertCandidate[]
deduplicateAlerts(newAlerts: AlertCandidate[], existingKeys: Set<string>): AlertCandidate[]
alertKey(alert: AlertCandidate): string
```

---

## @cpos/v4-csv

ケアプランデータ連携 V4 標準 CSV (CSVバージョン 202407) の reader/writer。

```typescript
// 中間表現
interface CarePlanBundle {
  utilizer: Utilizer;          // 氏名・被保険者番号・住所等
  careLevel: CareLevelInfo;    // 要介護度・有効期間
  careManager: CareManager;    // 居宅介護支援事業所
  plan1?: Plan1;               // 第1表 (作成日・課題分析・援助方針)
  plan2?: Plan2;               // 第2表 (problems[].goals[].supports[])
  plan3?: Plan3;               // 第3表 (週単位サービス + 日常活動)
  plan6?: Plan6;               // 第6表 (月間サービス計画)
  plan7?: Plan7;               // 第7表 (単位数集計)
  serviceTypeLimits?: ServiceTypeLimit[];
  senderOfficeCode: string;    // 10 桁
  senderServiceType: string;   // 既定 '43'
  receiverOfficeCode: string;
  receiverServiceType: string;
  csvVersion?: string;         // 既定 '202407'
}

// CSV 操作
async generateAllCsvs(bundle, options?): Promise<BuiltCsv[]>
async buildHosokuCsv(bundle, dt, kind: 'plan12'|'plan67'): Promise<BuiltCsv>
async buildPlan1Csv(bundle, dt): Promise<BuiltCsv>
async buildPlan2Csv(bundle, dt): Promise<BuiltCsv>
async buildPlan3Csv(bundle, dt): Promise<BuiltCsv>
async buildPlan6Csv(bundle, dt, summary?): Promise<BuiltCsv>
async buildPlan7Csv(bundle, dt): Promise<BuiltCsv>

// エンコード/デコード
async decodeCp932(buf: Buffer): Promise<string>
async encodeCp932(text: string): Promise<Buffer>
parseCsv(text: string): string[][]
serializeRow(row: string[]): string
serializeRows(rows: string[][]): string
toHankakuKana(s: string): string
wisemanQuote(value: string): string  // ワイズマン互換クォート

// 検証
detectFileType(rowsOrName): FileType
validateCsvBuffer(buf, fileType?): ValidationReport
validateUp2kyoHierarchy(rows): ValidationIssue[]  // ORA-00001 防止

// 列名
COLUMN_NAMES: Record<string, string[]>  // 'UPHOSOKU' / 'UP1KYO' 等
readV4Csv(buf, fileName): ParsedV4File

// コード
CSV_VERSION = '202407'
CARE_LEVEL_CODE: Record<string, string>      // '要介護1' → '21' 等
SEX_CODE / CERT_STATUS_CODE / DAY_OF_WEEK_CODE 等
formatDateYYYYMMDD(date): string
formatTimeHHMM(time): string
formatInt(n, width): string
```

---

## @cpos/excel-import

Excel ケアプラン / アセスメント取込パーサ。label-anchor 駆動で結合セル・和暦に対応。

```typescript
async parseCareplanWorkbook(buf: Buffer, fileName: string): Promise<ImportedCareplan>
async parseAssessmentWorkbook(buf: Buffer, fileName: string): Promise<ImportedAssessmentBundle>

// AICarePlan の編集 UI 用に変換
toGeneratedPlan(parsed: ImportedCareplan, label?: string): GeneratedPlan

// パーサユーティリティ (excel-utils)
normalizeSheet(ws): NormalizedSheet                  // 結合セル展開
findLabel(grid, label, opts): {row,col} | null       // ラベル位置検索
findAllLabels(grid, label, opts): Array<{row,col}>
valueOf(grid, anchor, dir: 'right'|'below'|'auto'): string
normLabel(s: string): string                         // 全空白除去 + 全角統一
parseJapaneseDate(s): { raw, iso?, wareki?, age? }   // 令和/平成/昭和 → ISO
parseDateRange(s): DateRangeValue
parseSelectionGroup(s): SelectionGroup               // ■□ + 【】
extractSelected(s): string | null
extractBracketed(s): string | null
parseEvidence(s): EvidenceValue
parseCategoryTag(s): CategoryTag
cellToString(v: unknown): string

// 主要型
interface ImportedCareplan {
  fileName: string;
  schemaVersion: 1;
  table1: ExcelTable1;          // 利用者基本情報 + 認定情報 + 援助方針
  table2: ExcelTable2;          // ニーズ → 目標 → サービス
  table3: ExcelTable3;          // 週単位スケジュール
  table4: ExcelTable4;          // サービス担当者会議
  table5: ExcelTable5;          // 居宅介護支援経過
  monitoring: ExcelMonitoring;  // モニタリング履歴
  sheetNames: string[];
  warnings: string[];
}

interface ImportedAssessmentBundle {
  fileName: string;
  schemaVersion: 1;
  faceSheet: ImportedFaceSheet;        // 基本・保険・認定・独立度・医療情報・連絡先
  assessment: ImportedAssessment;      // ADL/IADL/認知/特記
  anythingBox: ImportedAnythingBox;    // なんでもボックス
  doctorOpinion: ImportedDoctorOpinion;
  certificationSurvey: ImportedCertificationSurvey;
  sheetNames: string[];
  warnings: string[];
}
```

---

## @cpos/records (拡張)

利用者マスタ / 事業所アサイン / ケアプラン保存 / アラート / V4 CSV 抽出。

```typescript
// 利用者マスタ
interface MasterUser {
  insuredNumber: string;        // 10 桁または 'tmp-<random>' 仮 ID
  name: string;
  furigana?: string | null;
  gender?: 'male' | 'female' | string | null;
  birthDate?: string | null;
  postalCode?: string | null;
  address?: string | null;
  phone?: string | null;
  insurerNumber?: string | null;
  careLevel?: string | null;
  certificationStartDate?: string | null;
  certificationEndDate?: string | null;
  // 医療系 (本コミットで追加)
  medicalInsuranceType?: 'kokuho' | 'shaho' | 'koki' | 'kohi' | 'other' | null;
  medicalInsuredNumber?: string | null;
  medicalInsuredSymbol?: string | null;
  primaryDoctorName?: string | null;
  primaryDoctorPhone?: string | null;
  primaryDoctorOrg?: string | null;
  careManagerName?: string | null;
  careManagerPhone?: string | null;
  careManagerOrg?: string | null;
  emergencyContacts?: EmergencyContact[];
  diagnoses?: string[];
  status?: 'active' | 'suspended' | 'discharged' | null;
  extras?: Record<string, unknown>;     // 利用者フォルダID 等
  isActive?: boolean;
  organizationId: string;
  createdAt?: string; updatedAt?: string;
}

interface MasterUserListFilter {
  organizationId?: string;
  activeOnly?: boolean;
  /** 氏名・フリガナ・被保険者番号で部分一致 (`search` のエイリアス) */
  query?: string;
  /** `query` のエイリアス (アプリ側の語彙差を吸収) */
  search?: string;
  /** 利用者の状態で絞込 */
  status?: PatientStatus | PatientStatus[];
  facilityId?: string;
}

interface MasterUserRepository {
  list(filter?: MasterUserListFilter): Promise<MasterUser[]>;
  findByInsuredNumber(insuredNumber: string): Promise<MasterUser | null>;
  upsert(user: MasterUser): Promise<MasterUser>;
  delete(insuredNumber: string): Promise<void>;
}

interface UserFacilityAssignment {
  id: string;
  insuredNumber: string;
  facilityId: string;
  serviceType?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  isActive?: boolean;
  organizationId: string;
}
interface UserFacilityAssignmentRepository { /* list/findById/upsert/delete */ }

isTempInsuredNumber(insuredNumber): boolean

// 構造化ケアプラン保存
type CarePlanStatus = 'draft' | 'approved' | 'archived';

interface StoredCarePlan {
  id: string;
  organizationId: string;
  insuredNumber: string;
  label: string;
  summary?: string | null;
  bundle: CarePlanBundle;        // V4 標準型
  status: CarePlanStatus;
  approvedBy?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  sharedWith?: string[];
  exportedSpreadsheetId?: string | null;
  exportedAt?: string | null;
  generationMeta?: {
    model?: string | null;
    promptKey?: string | null;
    sourceFileIds?: string[];
    generatedAt?: string | null;
    proposalGroupId?: string | null;     // 同一 AI 生成バッチ
  } | null;
  extras?: Record<string, unknown>;     // 'aicareplan.table4' 等を格納可
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}
interface CarePlanRepository { /* list/findById/upsert/delete */ }

// 汎用アラート
interface Alert {
  id: string;
  organizationId: string;
  alertType: string;             // 'vns.instruction.expiry' 等のドット記法
  severity: 'info' | 'warning' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
  target?: { type: string; id: string; name?: string | null } | null;
  insuredNumber?: string | null;
  message: string;
  dueDate?: string | null;
  acknowledgedBy?: string | null;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  data?: Record<string, unknown>;
  createdAt: string; updatedAt: string;
}
interface AlertListFilter {
  organizationId?: string;
  alertType?: string | string[];
  severity?: AlertSeverity | AlertSeverity[];
  status?: AlertStatus | AlertStatus[];
  insuredNumber?: string;
  targetType?: string;
  targetId?: string;
  since?: string;     // createdAt >= since
  limit?: number;
}

interface AlertRepository {
  list(filter?: AlertListFilter): Promise<Alert[]>;
  findById(id: string): Promise<Alert | null>;
  upsert(alert: Alert): Promise<Alert>;
  delete(id: string): Promise<void>;
  /** 同ターゲットの open/acknowledged アラートが存在するかを高速判定 (バッチ重複防止用) */
  hasOpenForTarget(
    organizationId: string,
    alertType: string,
    target: { type: string; id: string }
  ): Promise<boolean>;
}

// V4 CSV 抽出ヘルパ
async extractCarePlanFromText(text, ai: AiTextProvider): Promise<ExtractedCarePlan>
async extractCarePlanFromPdf(buf, ai: AiDocumentProvider): Promise<ExtractedCarePlan>
buildBundleFromExtraction(ex, defaults): CarePlanBundle | { ok: false; missing: string[] }
```

---

## @cpos/ai (拡張)

`CarePlanGenerator` 抽象 + Gemini 実装。LLM プロバイダ非依存で複数案生成。

```typescript
interface CarePlanSource {
  kind: 'pdf-text' | 'json' | 'excel-imported' | 'sheets' | 'text';
  fileName: string;
  text: string;
}

interface CarePlanGenerationInput {
  utilizer: { name; insuredNumber; age?; careLevel?; insurerNumber?;
              sex?: '男'|'女'; birthDate?; address? };
  sources: CarePlanSource[];
  numProposals: number;
  businessMode: 'kyotaku' | 'shoki';
  knowledgeBase: string;
  generationPrompt: string;          // 空なら DEFAULT_CARE_PLAN_GENERATION_PROMPT
  modePrompt?: string;
  model?: string;
}

interface GeneratedCarePlan {
  label: string;                     // 'A 案' / 'B 案' / 'C 案'
  summary: string;
  bundle: CarePlanBundle;
  extras?: { table4?, table5?, table6? };
}

interface CarePlanGenerator {
  generate(input: CarePlanGenerationInput): Promise<GeneratedCarePlan[]>;
}

// Gemini 実装
class GeminiCarePlanGenerator implements CarePlanGenerator {
  constructor(config: { apiKey: string; model?: string;
                        generateTextOverride?: (p: string) => Promise<{text: string}> })
  generate(input): Promise<GeneratedCarePlan[]>
}

// ヘルパ
DEFAULT_CARE_PLAN_GENERATION_PROMPT: string  // {{NUM_PROPOSALS}} 変数対応
buildCarePlanGenerationPrompt(input): string
parseCarePlanProposalsArray(raw: string): RawProposal[]   // コードフェンス + JSON 配列
```

---

## @cpos/app-runtime (拡張)

Webhook 配信基盤 (HMAC-SHA256 署名)。

```typescript
interface Webhook {
  id: string;
  organizationId: string;
  url: string;
  secret: string;            // HMAC キー
  events: string[];          // 空配列なら全購読
  isActive: boolean;
  failureCount: number;      // 連続失敗カウンタ
  lastDeliveryAt?: string | null;
  lastDeliveryStatus?: number | null;
  lastError?: string | null;
  createdAt: string; updatedAt: string;
}

interface WebhookDeliveryLog { /* webhookId, eventType, payload, response, durationMs 等 */ }

interface WebhookRepository {
  list(filter?: WebhookListFilter): Promise<Webhook[]>;
  findById(id: string): Promise<Webhook | null>;
  upsert(w: Webhook): Promise<Webhook>;
  delete(id: string): Promise<void>;
  appendDeliveryLog(log: WebhookDeliveryLog): Promise<void>;
  listDeliveryLogs(webhookId: string, limit?: number): Promise<WebhookDeliveryLog[]>;
}

WEBHOOK_AUTO_DISABLE_THRESHOLD = 10  // 連続失敗で自動 isActive=false

signWebhookPayload(secret, body): string  // 'sha256=<hex>'
async deliverWebhookOnce(hook, eventType, eventId, payload, opts?):
  Promise<{ ok, status?, body?, durationMs, error? }>
async dispatchWebhookEvent(repo, organizationId, eventType, eventId, payload, opts?):
  Promise<{ delivered: number; failed: number }>
class MemoryWebhookRepository implements WebhookRepository
```

受信側でのシグネチャ検証例:

```typescript
const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
if (header('X-Cpos-Signature') !== `sha256=${expected}`) reject;
```

### 監査ログ ヘルパ

`apps/admin/src/server/audit/setup.ts` から提供:

```typescript
import { audit, auditFromRequest } from '../audit/setup.js';

// 低レベル: 全て自前で渡す
audit({
  organizationId: orgId,
  eventType: 'care-plan.generate',
  actor: { kind: 'user', id: session.userId, name: session.email, ip: req.ip ?? null },
  target: { type: 'care-plan', id: planId, name: user.name },
  status: 'ok',
  data: { proposalCount: 3 }
});

// 推奨: Express Request からセッション・IP・organizationId を自動補完
auditFromRequest(req, 'care-plan.generate',
  { type: 'care-plan', id: planId, name: user.name },
  { proposalCount: 3 });
```

---

## @cpos/records (追加: Trikea + FieldChange)

### Trikea CSV 取込 (トリケアトプス形式)

```typescript
parseTrikeaCsv(text: string): Array<Record<string, string>>

trikeaRowToMasterUser(
  row: Record<string, string>,
  opts: TrikeaToMasterUserOptions
): MasterUser | null

importTrikeaCsv(
  text: string,
  opts: TrikeaToMasterUserOptions
): TrikeaImportResult

interface TrikeaToMasterUserOptions {
  organizationId: string;
  /** 既存 Trikea ID マップ。提供すると insuredNumber と extras を引継 */
  existingByTrikeaId?: Map<string, MasterUser>;
}

interface TrikeaImportResult {
  totalRows: number;
  uniqueUsers: number;
  users: MasterUser[];
  warnings: string[];
  /** 検出されたヘッダの先頭 8 列。文字化け時の診断用 */
  headerSample: string[];
  /** 利用者ID 列が見つかったか。false なら文字コード不一致の可能性 */
  hasIdColumn: boolean;
}
```

> **クライアント側エンコーディング**: Trikea Topus は通常 cp932/Shift-JIS 出力。
> Admin UI (`MasterUsersPage`) は `readCsvFileAuto(file)` で UTF-8 → 失敗時
> Shift-JIS フォールバックを行う。`hasIdColumn === false` のとき UI は
> 「『利用者ID』列を検出できませんでした」とエラー + headerSample を表示する。

特徴:
- 同一 利用者ID の複数行は中止日が最新の行を採用 (なければ最終行)
- 全角数字キー (関係者１〜５、医療機関１〜５、病歴１〜５ 等) を網羅
- 関係者１〜５ → `MasterUser.emergencyContacts[]` (priority 順)
- 病歴１〜５ → `diagnoses[]` (`[0]` = 主傷病名規約に従う)
- 医療機関１ → `primaryDoctorName/Org/Phone`、２〜５は `extras.他医療機関`
- 中止日 set → `status='discharged'`、利用停止日のみ → `'suspended'`
- 被保険者番号は CSV に無いので `tmp-trikea-<padded-id>` 自動発行

### FieldChange (フィールド粒度変更追跡)

```typescript
interface FieldChange {
  id: string;
  organizationId: string;
  entityType: string;          // 'master-user' / 'care-plan' / 'vns.visit-record' 等
  entityId: string;
  fieldPath: string;           // 'name' / 'diagnoses[0]' / 'plan2.problems[0].goals[0].longTermGoal'
  insuredNumber?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  source: string;              // 'NandemoBox' / 'ExcelImport:foo.xlsx' / 'AI:Gemini' / 'Manual' 等
  sourceDetail?: Record<string, unknown> | null;
  changedBy?: string | null;
  changedByName?: string | null;
  changedAt: string;
}

interface FieldChangeListFilter {
  organizationId?: string;
  entityType?: string;
  entityId?: string;
  fieldPathPrefix?: string;    // 'plan2' で第2表全体の変更履歴
  insuredNumber?: string;
  source?: string;
  changedBy?: string;
  since?: string; until?: string;
  limit?: number;
}

interface FieldChangeRepository {
  append(change: FieldChange): Promise<void>;
  appendMany(changes: FieldChange[]): Promise<void>;
  list(filter?: FieldChangeListFilter): Promise<FieldChange[]>;
  listByEntity(orgId, entityType, entityId, limit?): Promise<FieldChange[]>;
  listByField(orgId, entityType, entityId, fieldPath, limit?): Promise<FieldChange[]>;
}

class MemoryFieldChangeRepository implements FieldChangeRepository {
  constructor(capacity?: number)  // 既定 10000、リングバッファ
}

// 2 オブジェクトの差分から FieldChange[] を生成
diffAsFieldChanges(
  oldObj: Record<string, unknown> | null,
  newObj: Record<string, unknown> | null,
  meta: DiffMeta,
  idGen?: () => string
): FieldChange[]

interface DiffMeta {
  organizationId: string;
  entityType: string;
  entityId: string;
  insuredNumber?: string | null;
  source: string;
  sourceDetail?: Record<string, unknown> | null;
  changedBy?: string | null;
  changedByName?: string | null;
  watchPaths?: string[];       // 監視対象パスを限定
}
```

監査ログ (`AuditEvent`) は API リクエスト粒度、`FieldChange` はフィールド粒度。
**併用** する設計。

---

## @cpos/types (追加: PromptTemplate 拡張)

```typescript
interface PromptTemplate {
  // 既存フィールド ...
  /**
   * 事業所固有のオーバーライド先 (null/undefined = 全社共通)。
   * 設定されていると、`baseTemplateId` が指す全社共通テンプレを上書きする。
   * 解決順: facilityId 一致あり → baseTemplateId の全社版 → built-in。
   */
  facilityId?: string | null;
  /** 上書きする全社共通テンプレート ID (facilityId set 時に必要) */
  baseTemplateId?: string | null;
}
```

---

## @cpos/app-runtime (追加: Manifest 拡張)

> **export 経路**: `CposAppManifest` / `WebhookEventDeclaration` /
> `ScheduledTaskDeclaration` は **`@cpos/app-runtime`** から export される
> (canonical)。`@cpos/types` には置かない。
>
> ```typescript
> import type {
>   CposAppManifest,
>   WebhookEventDeclaration,
>   ScheduledTaskDeclaration
> } from '@cpos/app-runtime';
> ```

```typescript
interface CposAppManifest {
  // 既存フィールド ...
  /** このアプリが発火する Webhook イベント名の宣言 */
  webhookEvents?: WebhookEventDeclaration[];
  /** このアプリが宣言する定期タスク (永続スケジューラに反映) */
  scheduledTasks?: ScheduledTaskDeclaration[];
}

interface WebhookEventDeclaration {
  name: string;             // 'vns.visit-record.created' 等
  description: string;
  payloadType?: string;     // TypeScript インタフェース名等
}

interface ScheduledTaskDeclaration {
  taskKey: string;          // 'vns.alerts.daily' 等
  schedule: string;         // cron 式 '0 23 * * *'
  timezone?: string;        // 既定 'UTC'
  description?: string;
  /**
   * 起動エンドポイント。
   * - **path 部分のみ** (例: '/api/triggers/vns-alerts') を推奨。
   *   CPOS 管理コンソールが Cloud Scheduler 登録時に
   *   `https://<アプリの公開ドメイン>` を前置して完全 URL を生成する。
   * - 同居アプリ (apps/admin) からの呼出しは相対パスがそのまま動く。
   * - 別ホスト (登録アプリで独自ドメイン) を指す場合は完全 URL も可。
   */
  endpoint: string;
  method?: 'GET' | 'POST';  // 既定 'POST'
}
```

### Cloud Scheduler / Trigger ヘッダ規約

定期タスク (Cloud Scheduler → アプリ HTTP) の認証は以下のヘッダ規約で統一する:

| ヘッダ | 意味 | 必須 |
|---|---|---|
| `X-Cpos-Trigger-Secret` | アプリ毎に発行される共有秘密 (HMAC-SHA256 hex) | ✅ |
| `X-Cpos-Trigger-Task` | manifest の `taskKey` (例 `vns.alerts.daily`) | ✅ |
| `X-Cpos-Trigger-Time` | ISO8601 (送信時刻) | 推奨 |
| `User-Agent` | `Google-Cloud-Scheduler` を確認しても良い | 任意 |

アプリ側は `X-Cpos-Trigger-Secret` を `process.env.CPOS_TRIGGER_SECRET` と
時間定数比較 (`crypto.timingSafeEqual`) で照合する。一致しなければ 401。
申し送り (`/api/triggers/handover`) も同じ規約。

cpos.manifest.json の例:

```json
{
  "name": "vns",
  "webhookEvents": [
    { "name": "vns.visit-record.created", "description": "訪問記録作成時" },
    { "name": "vns.instruction.expiring", "description": "指示書期限間近" }
  ],
  "scheduledTasks": [
    {
      "taskKey": "vns.alerts.daily",
      "schedule": "0 23 * * *",
      "timezone": "UTC",
      "description": "日次アラートチェック",
      "endpoint": "/api/triggers/vns-alerts"
    }
  ]
}
```

---

## @cpos/records (追加: 事業所 Import / Export + 拡張フィールド)

`FacilityConfig` の拡張フィールド (1 法人内の事業所マスタ向け):

```typescript
interface FacilityConfig {
  // 既存フィールド ...
  /** 事業所名カナ */
  nameKana?: string;
  /** 郵便番号 (ハイフン無 7 桁 / `XXX-XXXX` どちらも許容) */
  postalCode?: string;
  /** 住所 (都道府県〜建物名まで 1 行) */
  address?: string;
  /** 事業所代表電話 */
  phone?: string;
  /** 事業所代表 FAX */
  fax?: string;
  /**
   * 事業所施設区分コード (CPOS 内部分類)。
   * `@cpos/v4-csv` の `FACILITY_CATEGORY_CODE` を参照。1 事業所 1 区分。
   */
  facilityCategoryCode?: string;
  /**
   * 提供する介護保険サービス種類コード (V4 附録A の 2 桁、複数可)。
   * `@cpos/v4-csv` の `SERVICE_TYPE_CODE` を参照。
   * 1 事業所が複数サービスを提供できるため配列で持つ。
   */
  serviceTypeCodes?: string[];

  /**
   * @deprecated 撤去予定 (国保連送信ワークフローで未使用)。
   * 既存値は読み取り専用で残置。
   */
  destinationProviderNumber?: string;
}
```

### 事業所 JSON Import / Export

```typescript
const FACILITY_EXPORT_FORMAT_VERSION = '1';

interface FacilityExportFile {
  formatVersion: string;        // '1'
  exportedAt: string;           // ISO 8601
  organizationId?: string;
  facilities: FacilityExportItem[];
}

interface FacilityExportItem {
  id: string;                   // 一次キー (再 import で同 ID 上書き)
  name: string;                 // 必須
  nameKana?: string | null;
  businessNumber?: string | null;     // 10 桁
  insurerNumber?: string | null;      // 6 桁
  postalCode?: string | null;
  address?: string | null;
  phone?: string | null;
  fax?: string | null;
  facilityCategoryCode?: string | null;
  facilityCategoryName?: string | null;  // 派生 (Export 時のみ)
  serviceTypeCodes?: string[];
  serviceTypeNames?: string[];           // 派生 (Export 時のみ)
  timeZone?: string | null;
  facilityNamePrefix?: string | null;
  isActive?: boolean;
}

// Export
buildFacilityExportFile(
  facilities: FacilityConfig[],
  opts?: {
    organizationId?: string;
    lookupServiceTypeName?: (code: string) => string | null;
    lookupFacilityCategoryName?: (code: string) => string | null;
  }
): FacilityExportFile

facilityToExportItem(f: FacilityConfig, lookups?): FacilityExportItem

// Import
validateFacilityExportFile(input: unknown): FacilityExportFile  // throw on invalid
importItemToFacilityConfig(
  item: FacilityExportItem,
  organizationId: string,
  existing?: FacilityConfig
): FacilityConfig
```

- `formatVersion` 不一致 / `facilities` 配列欠落は throw (誤ファイル防止)
- 派生フィールド (`facilityCategoryName` / `serviceTypeNames`) は Export 時の
  補助情報として埋まり、Import 時は無視 (コードから再計算)
- `existing` を渡すと `users` / `records` / `handover` 等の UI 設定を保持

### コード ↔ 名称の Lookup (`@cpos/v4-csv`)

```typescript
SERVICE_TYPE_CODE: Record<string, string>            // 名称 → コード
SERVICE_TYPE_NAME_BY_CODE: Record<string, string>    // コード → 名称
lookupServiceTypeName(code): string | null

FACILITY_CATEGORY_CODE: Record<string, string>             // 名称 → コード
FACILITY_CATEGORY_NAME_BY_CODE: Record<string, string>     // コード → 名称
lookupFacilityCategoryName(code): string | null
```

UI でコード入力時に名称を自動表示する用途。`SERVICE_TYPE_CODE` は厚労省 V4
附録A 抜粋、`FACILITY_CATEGORY_CODE` は CPOS 内部分類 (請求 CSV のコードとは別)。

`SERVICE_TYPE_CODE` には **介護給付サービス + 介護予防サービス + 地域密着型 +
地域密着型介護予防サービス** を網羅:

| 区分 | 主要コード |
|---|---|
| 介護給付 (居宅) | `11` 訪問介護 / `12` 訪問入浴介護 / `13` 訪問看護 / `14` 訪問リハ / `15` 通所介護 / `16` 通所リハ / `17` 福祉用具貸与 / `21-23,2A` 短期入所 / `31` 居宅療養管理指導 / `43` 居宅介護支援 |
| 介護予防 (居宅) | `62` 訪問入浴 / `63` 訪問看護 / `64` 訪問リハ / `66` 通所リハ / `67` 福祉用具貸与 / `24-26,2B` 短期入所 / `34` 居宅療養管理指導 |
| 地域密着型 | `27,28` 特定施設(短期) / `38` 認知症共同生活(短期) / `68` 小規模多機能(短期) / `71` 夜間訪問介護 / `72` 認知症通所 / `73` 小規模多機能 / `76` 定期巡回 / `77` 看護小規模多機能 / `78` 地域密着型通所 / `79` 看護小規模多機能(短期) |
| 地域密着型介護予防 | `36,39` 認知症共同生活 / `69,75` 小規模多機能 / `74` 認知症通所 |

> 介護予防訪問介護 (旧コード `11`) は 2018 年に総合事業化により廃止されたため
> 含めていない。「介護予防」と付かない `11` は介護給付の訪問介護のみを指す。

---

## SystemSettings (apps/admin) — 法人 / 事業所 / システム共通設定

CPOS のシステム共通設定 (1 インストールにつき 1 通り) を表す型。
**法人 (= 事業者) 設定はこちら、事業所単位の設定は `FacilityConfig` に持たせる**
という分離が原則。

```typescript
// apps/admin/src/server/system-settings/types.ts
interface SystemSettings {
  filing?: SystemFilingConfig;
  userFolders?: UserFolderConfig;
  personalDoc?: PersonalRecordDocConfig;
  importantMattersDoc?: ImportantMattersDocConfig;
  carePlan?: CarePlanSystemSettings;
  corporation?: CorporationSettings;   // ← 法人 (= 事業者) 設定 (新規)
  updatedAt?: string;
  updatedBy?: string | null;
}

// 法人 (= 事業者) 共通設定。1 インストールにつき 1 法人。
// 事業所番号 / サービス種別コードは事業所ごとなので含めない。
interface CorporationSettings {
  /** 法人名 (例: 「株式会社○○」) */
  name?: string;
  /** 法人番号 (国税庁の 13 桁) */
  corporationNumber?: string;
  /** 法人代表者氏名 (任意) */
  representativeName?: string;
  /** 法人本社所在地 (任意) */
  headOfficeAddress?: string;
  /** 法人代表電話 (任意) */
  representativePhone?: string;
}
```

### 設定の責任分担

| 設定項目 | どこに持つか | 理由 |
|---|---|---|
| 法人名・法人番号・代表者氏名 | `SystemSettings.corporation` | 1 法人運営前提 (システム共通) |
| 事業所名 / 事業所番号 (10 桁) / 保険者番号 / 送信先事業所番号 | `FacilityConfig` | 事業所ごとに異なる |
| サービス種別コード | `FacilityConfig` (or assignment) | 事業所単位のサービス分類 |
| AutoFiler / 利用者フォルダ / 個人記録 Doc / 重要事項 Doc | `SystemSettings.filing` 等 | システム共通ルール |
| AI プロンプト・モード | `SystemSettings.carePlan` + `PromptTemplate.facilityId` | 全社共通 → 事業所別オーバーライド |

### `FacilityConfig.corporationName` の取り扱い (deprecated)

旧バージョンでは `FacilityConfig.corporationName` を事業所単位に持っていたが、
法人は本システム上 1 件であるため `SystemSettings.corporation.name` に移行した。
`FacilityConfig.corporationName` は **`@deprecated` 化** され、新規入力は不可。
v4-exports は `corporation.name` を優先し、未設定なら facility 値にフォールバック。

API:
| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/system-settings/corporation` | 法人設定取得 |
| PUT | `/api/system-settings/corporation` | 法人設定更新 (manager+) |

---

## @cpos/client-sdk

ブラウザ / SPA 向け API クライアント。同居アプリ (apps/admin) と独立 SPA
(登録アプリ) のどちらからも同じ呼び出しコードで使える。

```typescript
interface ApiClientConfig {
  baseUrl?: string;             // 既定 '/api'
  credentials?: RequestCredentials;  // 既定 'include' (Cookie 共有)
  defaultHeaders?: Record<string, string>;
  getDynamicHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  fetchImpl?: typeof fetch;     // テスト用
}

interface ApiClient {
  get<T>(path: string, init?: RequestInit): Promise<T>;
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  put<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  delete<T>(path: string, init?: RequestInit): Promise<T>;
  raw<T>(path: string, init?: RequestInit): Promise<T>;  // multipart 等
}

class ApiError extends Error {
  status: number;
  body: unknown;
}

createApiClient(config?: ApiClientConfig): ApiClient

// 同居アプリ用デフォルト (baseUrl='/api', credentials='include')
const apiRaw: ApiClient
```

使用例 (独立 SPA):

```typescript
import { createApiClient } from '@cpos/client-sdk';

const apiRaw = createApiClient({
  baseUrl: 'https://os.care-planning.co.jp/api',
  credentials: 'include',
  defaultHeaders: { 'X-App-Id': 'vns' }
});
const users = await apiRaw.get('/master-users');
```

---

## @cpos/pdf

Puppeteer ベースの PDF 生成基盤。

```typescript
interface PdfRenderOptions {
  format?: 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal' | 'Tabloid';
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  landscape?: boolean;
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  printBackground?: boolean;
  scale?: number;            // 0.1〜2.0
  timeout?: number;          // ms、既定 30000
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
}

interface PdfRendererConfig {
  executablePath?: string;          // 既定 PUPPETEER_EXECUTABLE_PATH 環境変数
  launchArgs?: string[];            // 既定 ['--no-sandbox', '--disable-setuid-sandbox']
  recycleAfterRequests?: number;    // N リクエストで再起動 (既定 100)
  recycleAfterMs?: number;          // N ms 経過で再起動 (既定 60 分)
  fakeRenderer?: (html, options) => Promise<Buffer>;  // テスト用
}

class PdfRenderer {
  constructor(config?: PdfRendererConfig)
  renderPdf(html: string, options?: PdfRenderOptions): Promise<Buffer>
  close(): Promise<void>
}

// プロセス内シングルトン
getDefaultPdfRenderer(config?: PdfRendererConfig): PdfRenderer
closeDefaultPdfRenderer(): Promise<void>
```

Cloud Run / Docker での Chromium 同梱 (アプリ側 Dockerfile):

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-noto-cjk fonts-liberation \
    libnss3 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
```

シャットダウンフックで browser を確実に閉じる:

```typescript
process.on('SIGTERM', async () => {
  await closeDefaultPdfRenderer();
});
```
