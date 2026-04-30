type ModelCenterErrorStateProps = {
  message: string;
};

export function ModelCenterErrorState({ message }: ModelCenterErrorStateProps) {
  return (
    <section className="card">
      <div className="stack stack--tight">
        <h2>模型中心暂时不可用</h2>
        <p className="muted">
          当前无法从独立中控服务拉取模型配置。请先确认 <code>apps/control-api</code> 已启动，再刷新页面重试。
        </p>
        <p className="helper-text">{message}</p>
      </div>
    </section>
  );
}
