const qrcode = require("qrcode-terminal");
const crypto = require("crypto");
const {
  Client,
  LocalAuth,
} = require("whatsapp-web.js");

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "dice-bot",
  }),

  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  },
});

/*
 * Guarda mensagens já processadas.
 * Isso evita que o mesmo comando seja executado mais de uma vez.
 */
const processedMessages = new Set();

/*
 * Remove IDs antigos da memória.
 */
setInterval(() => {
  processedMessages.clear();
}, 5 * 60 * 1000);

/**
 * Exemplos aceitos:
 *
 * !r d20
 * !r 2d6
 * !r 2d6+3
 * !r 1d20-5
 * !roll d100
 */
function parseDiceExpression(expression) {
  const normalized = expression
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

  const match = normalized.match(
    /^(\d*)d(\d+)([+-]\d+)?$/,
  );

  if (!match) {
    return null;
  }

  const quantity =
    match[1] === ""
      ? 1
      : Number(match[1]);

  const sides = Number(match[2]);

  const modifier =
    match[3] !== undefined
      ? Number(match[3])
      : 0;

  if (!Number.isInteger(quantity)) {
    throw new Error(
      "A quantidade de dados precisa ser um número inteiro.",
    );
  }

  if (!Number.isInteger(sides)) {
    throw new Error(
      "A quantidade de faces precisa ser um número inteiro.",
    );
  }

  if (!Number.isInteger(modifier)) {
    throw new Error(
      "O modificador precisa ser um número inteiro.",
    );
  }

  if (quantity < 1 || quantity > 100) {
    throw new Error(
      "Use entre 1 e 100 dados.",
    );
  }

  if (sides < 2 || sides > 10000) {
    throw new Error(
      "O dado deve ter entre 2 e 10.000 faces.",
    );
  }

  if (modifier < -100000 || modifier > 100000) {
    throw new Error(
      "O modificador informado é muito grande.",
    );
  }

  return {
    quantity,
    sides,
    modifier,
  };
}

function rollDice({
  quantity,
  sides,
  modifier,
}) {
  const rolls = [];

  for (
    let index = 0;
    index < quantity;
    index += 1
  ) {
    rolls.push(
      crypto.randomInt(1, sides + 1),
    );
  }

  const diceTotal = rolls.reduce(
    (sum, roll) => sum + roll,
    0,
  );

  return {
    rolls,
    diceTotal,
    total: diceTotal + modifier,
  };
}

function formatModifier(modifier) {
  if (modifier > 0) {
    return `+${modifier}`;
  }

  if (modifier < 0) {
    return `${modifier}`;
  }

  return "";
}

function formatResponse(parsed, result) {
  const {
    quantity,
    sides,
    modifier,
  } = parsed;

  const expression =
    `${quantity}d${sides}` +
    formatModifier(modifier);

  if (quantity === 1 && modifier === 0) {
    return [
      "🎲 Rolagem",
      "",
      `*${expression} = ${result.total}*`,
    ].join("\n");
  }

  const lines = [
    "🎲 Rolagem",
    "",
    `Expressão: *${expression}*`,
    `Dados: ${result.rolls.join(" + ")}`,
  ];

  if (modifier !== 0) {
    const modifierText =
      modifier > 0
        ? `+ ${modifier}`
        : `- ${Math.abs(modifier)}`;

    lines.push(
      `Cálculo: ${result.diceTotal} ${modifierText}`,
    );
  }

  lines.push(`*Total: ${result.total}*`);

  return lines.join("\n");
}

function getHelpMessage() {
  return [
    "🎲 *Bot de dados*",
    "",
    "Comandos disponíveis:",
    "",
    "!r d20",
    "!r 2d6",
    "!r 1d20+7",
    "!r 2d8-2",
    "!roll d100",
  ].join("\n");
}

function getMessageId(message) {
  try {
    return message.id?._serialized || null;
  } catch {
    return null;
  }
}

function getChatId(message) {
  /*
   * Mensagem enviada pela própria conta:
   * o destino está normalmente em message.to.
   *
   * Mensagem recebida:
   * a origem da conversa está em message.from.
   */
  if (message.fromMe && message.to) {
    return message.to;
  }

  return message.from;
}

async function sendMessage(chatId, content) {
  if (!chatId) {
    throw new Error(
      "Não foi possível identificar a conversa.",
    );
  }

  await client.sendMessage(
    chatId,
    content,
  );
}

client.on("qr", (qr) => {
  console.log("");
  console.log(
    "Escaneie o QR Code pelo WhatsApp:",
  );
  console.log("");

  qrcode.generate(qr, {
    small: true,
  });
});

client.on(
  "loading_screen",
  (percent, message) => {
    console.log(
      `Carregando: ${percent}% — ${message}`,
    );
  },
);

client.on("authenticated", () => {
  console.log(
    "WhatsApp autenticado.",
  );
});

client.on("ready", () => {
  console.log("");
  console.log(
    "===================================",
  );
  console.log(
    "🎲 BOT DE DADOS CONECTADO",
  );
  console.log(
    "Envie no WhatsApp: !r d20",
  );
  console.log(
    "===================================",
  );
  console.log("");
});

client.on("auth_failure", (error) => {
  console.error(
    "Falha na autenticação:",
    error,
  );
});

client.on("disconnected", (reason) => {
  console.error(
    "WhatsApp desconectado:",
    reason,
  );
});

/*
 * IMPORTANTE:
 *
 * Existe somente este listener de mensagens.
 * Não adicione outro client.on("message")
 * ou client.on("message_create").
 */
client.on(
  "message_create",
  async (message) => {
    const messageId =
      getMessageId(message);

    try {
      const body =
        typeof message.body === "string"
          ? message.body.trim()
          : "";

      if (!body) {
        return;
      }

      /*
       * Evita processar novamente
       * a mesma mensagem.
       */
      if (
        messageId &&
        processedMessages.has(messageId)
      ) {
        return;
      }

      if (messageId) {
        processedMessages.add(messageId);
      }

      /*
       * Ignora mensagens geradas pelo próprio bot.
       */
      if (
        body.startsWith("🎲 Rolagem") ||
        body.startsWith("❌ Erro") ||
        body.startsWith("🎲 *Bot de dados*")
      ) {
        return;
      }

      console.log("--------------------------------");
      console.log("Mensagem detectada");
      console.log("Texto:", body);
      console.log("From:", message.from);
      console.log("To:", message.to);
      console.log("FromMe:", message.fromMe);
      console.log("ID:", messageId);
      console.log("--------------------------------");

      const chatId =
        getChatId(message);

      /*
       * Comando de ajuda.
       */
      if (/^!dados$/i.test(body)) {
        await sendMessage(
          chatId,
          getHelpMessage(),
        );

        return;
      }

      /*
       * Detecta somente comandos:
       *
       * !r expressão
       * !roll expressão
       */
      const commandMatch = body.match(
        /^!(?:r|roll)\s+(.+)$/i,
      );

      if (!commandMatch) {
        return;
      }

      const expression =
        commandMatch[1];

      const parsed =
        parseDiceExpression(expression);

      if (!parsed) {
        await sendMessage(
          chatId,
          [
            "❌ Erro: rolagem inválida.",
            "",
            "Exemplos:",
            "!r d20",
            "!r 2d6",
            "!r 2d6+3",
            "!r 1d20-2",
          ].join("\n"),
        );

        return;
      }

      const result =
        rollDice(parsed);

      const response =
        formatResponse(
          parsed,
          result,
        );

      await sendMessage(
        chatId,
        response,
      );

      console.log(
        `Rolagem realizada: ${expression}`,
      );

      console.log(
        `Resultado: ${result.total}`,
      );
    } catch (error) {
      console.error(
        "Erro ao processar mensagem:",
        error,
      );

      /*
       * Não tenta enviar mensagem de erro
       * para evitar um segundo erro em cascata.
       */
    }
  },
);

client.initialize();