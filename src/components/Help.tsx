import { Empty } from '../ui';
export function Help() {
  return (
    <>
      <div className="heading">
        <div>
          <span className="eyebrow">COMECE POR AQUI</span>
          <h1>Do WhatsApp para sua IA</h1>
          <p>Uma conexão simples, com controle em cada etapa.</p>
        </div>
      </div>
      <div className="panel prose">
        <h2>1. Conecte uma sessão</h2>
        <p>
          Crie uma sessão e clique em Conectar WhatsApp. No celular, abra WhatsApp → Aparelhos conectados →
          Conectar aparelho e escaneie o QR Code.
        </p>
        <h2>2. Gere uma credencial</h2>
        <p>
          Na aba Acesso MCP, crie um token para cada integração. Somente leitura é o padrão; leitura e envio
          permite que a ferramenta envie mensagens.
        </p>
        <h2>3. Configure seu cliente MCP</h2>
        <p>
          Use o endereço da sessão com transporte Streamable HTTP e o cabeçalho Authorization: Bearer
          SEU_TOKEN. O cliente precisa aceitar tokens Bearer personalizados.
        </p>
        <h2>4. Mantenha o aplicativo aberto</h2>
        <p>
          Fechar a janela mantém o aplicativo na bandeja. Sair pelo menu encerra as conexões. O computador
          precisa estar ligado e conectado à internet.
        </p>
        <Empty
          title="Histórico local"
          detail="A sincronização depende do histórico disponibilizado pelo WhatsApp. Mídias aparecem identificadas, sem download de anexos nesta versão."
        />
      </div>
    </>
  );
}
