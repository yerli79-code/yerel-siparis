export type PublicOrderDeliveryAddress = {
  district: string;
  neighborhood: string;
  streetAddress: string;
  building: string;
  floorUnit: string;
  directions: string;
};

export const emptyPublicOrderDeliveryAddress: PublicOrderDeliveryAddress = {
  district: "",
  neighborhood: "",
  streetAddress: "",
  building: "",
  floorUnit: "",
  directions: "",
};

const addressLabels: Array<
  [keyof PublicOrderDeliveryAddress, string]
> = [
  ["district", "İlçe"],
  ["neighborhood", "Mahalle"],
  ["streetAddress", "Adres"],
  ["building", "Bina"],
  ["floorUnit", "Kat/Daire"],
  ["directions", "Tarif"],
];

export function composePublicOrderDeliveryAddress(
  address: PublicOrderDeliveryAddress,
) {
  return addressLabels
    .flatMap(([field, label]) => {
      const value = address[field].trim();
      return value ? [`${label}: ${value}`] : [];
    })
    .join("\n");
}

export function parsePublicOrderDeliveryAddress(
  value: string,
): PublicOrderDeliveryAddress {
  const normalizedValue = value.trim();
  if (!normalizedValue) return { ...emptyPublicOrderDeliveryAddress };

  const parsedAddress = { ...emptyPublicOrderDeliveryAddress };
  let recognizedLineCount = 0;
  const unrecognizedLines: string[] = [];

  normalizedValue.split(/\r?\n/).forEach((line) => {
    const matchingLabel = addressLabels.find(([, label]) =>
      line.startsWith(`${label}:`),
    );
    if (!matchingLabel) {
      unrecognizedLines.push(line);
      return;
    }

    const [field, label] = matchingLabel;
    const fieldValue = line.slice(label.length + 1).trim();
    parsedAddress[field] = [parsedAddress[field], fieldValue]
      .filter(Boolean)
      .join("\n");
    recognizedLineCount += 1;
  });

  if (recognizedLineCount > 0) {
    const legacyText = unrecognizedLines.join("\n").trim();
    if (legacyText) {
      parsedAddress.streetAddress = [parsedAddress.streetAddress, legacyText]
        .filter(Boolean)
        .join("\n");
    }

    return parsedAddress;
  }

  return {
    ...emptyPublicOrderDeliveryAddress,
    streetAddress: normalizedValue,
  };
}
