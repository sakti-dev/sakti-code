export const directiveAttributeProps = (
  attributes?: Record<string, string>
): Record<string, string> => {
  if (!attributes) {
    return {};
  }

  const props: Record<string, string> = {};

  for (const [key, value] of Object.entries(attributes)) {
    props[`data-velomark-attr-${key}`] = value;
  }

  return props;
};
